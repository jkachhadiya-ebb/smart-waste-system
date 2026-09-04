import { useCallback, useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';
import {
  changePassword,
  disable2fa,
  fetch2faSetup,
  fetchSessions,
  logoutAllSessions,
  logoutThisSession,
  verify2fa,
} from '../../api/settingsApi.js';

export default function SecurityTab({ forceRefreshKey, onDirtyChange }) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [sessionLoading, setSessionLoading] = useState({ this: false, all: false });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    logoutAllOtherDevices: false,
  });
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [setupInfo, setSetupInfo] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [disableForm, setDisableForm] = useState({ code: '', password: '' });
  const [disableLoading, setDisableLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionsError('');
    try {
      const { data } = await fetchSessions();
      setSessions(data.sessions || []);
      setCurrentSessionId(data.currentSessionId);
      setMfaEnabled(Boolean(data.mfaEnabled));
    } catch (err) {
      console.error('Fetch sessions failed', err);
      setSessionsError(err.response?.data?.message || 'Could not load sessions');
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [forceRefreshKey, loadSessions]);

  const passwordDirty =
    passwordForm.currentPassword ||
    passwordForm.newPassword ||
    passwordForm.confirmPassword ||
    passwordForm.logoutAllOtherDevices;
  const totpDirty = Boolean(setupInfo?.otpauth_uri) || setupCode || disableForm.code || disableForm.password;
  const securityDirty = passwordDirty || totpDirty;

  useEffect(() => {
    onDirtyChange?.(securityDirty);
  }, [onDirtyChange, securityDirty]);

  useDirtyGuard(securityDirty);

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error(t('New password and confirmation do not match'));
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        logoutAllOtherDevices: passwordForm.logoutAllOtherDevices,
      });
      toast.success(t('Password changed successfully'));
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '', logoutAllOtherDevices: false });
      loadSessions();
    } catch (err) {
      console.error('Change password failed', err);
      toast.error(t(err.response?.data?.message || 'Password change failed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const start2faSetup = async () => {
    setSetupLoading(true);
    try {
      const { data } = await fetch2faSetup();
      setSetupInfo(data);
    } catch (err) {
      console.error('2FA setup failed', err);
      toast.error(t(err.response?.data?.message || 'Could not prepare 2FA setup'));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleVerify2fa = async () => {
    if (!setupCode) {
      toast.error(t('Enter the 6-digit code from your authenticator'));
      return;
    }
    try {
      await verify2fa(setupCode);
      toast.success(t('2FA enabled'));
      setSetupInfo(null);
      setSetupCode('');
      setMfaEnabled(true);
      loadSessions();
    } catch (err) {
      console.error('Verify 2FA failed', err);
      toast.error(t(err.response?.data?.message || 'Failed to verify code'));
    }
  };

  const handleDisable2fa = async () => {
    if (!disableForm.code && !disableForm.password) {
      toast.error(t('Provide either a TOTP code or your password'));
      return;
    }
    setDisableLoading(true);
    try {
      await disable2fa({ code: disableForm.code, password: disableForm.password });
      toast.success(t('2FA disabled'));
      setMfaEnabled(false);
      setDisableForm({ code: '', password: '' });
      loadSessions();
    } catch (err) {
      console.error('Disable 2FA failed', err);
      toast.error(t(err.response?.data?.message || 'Could not disable 2FA'));
    } finally {
      setDisableLoading(false);
    }
  };

  const handleLogoutThis = async () => {
    if (!currentSessionId) return;
    setSessionLoading((prev) => ({ ...prev, this: true }));
    try {
      await logoutThisSession();
      toast.success(t('This session has been revoked'));
      loadSessions();
    } catch (err) {
      console.error('Logout this failed', err);
      toast.error(t(err.response?.data?.message || 'Could not revoke current session'));
    } finally {
      setSessionLoading((prev) => ({ ...prev, this: false }));
    }
  };

  const handleLogoutAll = async () => {
    setSessionLoading((prev) => ({ ...prev, all: true }));
    try {
      await logoutAllSessions();
      toast.success(t('All sessions revoked'));
      loadSessions();
    } catch (err) {
      console.error('Logout all failed', err);
      toast.error(t(err.response?.data?.message || 'Could not revoke all sessions'));
    } finally {
      setSessionLoading((prev) => ({ ...prev, all: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Change password')}</h3>
            <p className="text-sm text-slate-500">
              {t('Use your current password to set a new one.')}
            </p>
          </div>
        </div>
        <div className="grid gap-4">
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            placeholder={t('Current password')}
            value={passwordForm.currentPassword}
            onChange={(event) =>
              setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
            }
          />
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            placeholder={t('New password')}
            value={passwordForm.newPassword}
            onChange={(event) =>
              setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))
            }
          />
          <input
            type="password"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            placeholder={t('Confirm new password')}
            value={passwordForm.confirmPassword}
            onChange={(event) =>
              setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
            }
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={passwordForm.logoutAllOtherDevices}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, logoutAllOtherDevices: event.target.checked }))
              }
            />
            {t('Logout from other devices by default')}
          </label>
        </div>
        <button
          type="button"
          className="btn-primary px-5 py-2"
          disabled={passwordLoading}
          onClick={handlePasswordChange}
        >
          {passwordLoading ? t('Saving...') : t('Change password')}
        </button>
      </div>

      <div className="panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Two-Factor Authentication')}</h3>
            <p className="text-sm text-slate-500">
              {t('Protect your account with an authenticator app. Use the QR code to add the account.')}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              mfaEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {mfaEnabled ? t('Enabled') : t('Disabled')}
          </span>
        </div>

        {!mfaEnabled && !setupInfo && (
          <button
            type="button"
            className="btn-secondary px-5 py-2"
            disabled={setupLoading}
            onClick={start2faSetup}
          >
            {setupLoading ? t('Preparing...') : t('Enable Two-Factor Authentication')}
          </button>
        )}

        {setupInfo && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <p className="mb-2 font-semibold text-slate-700">{t('Scan this QR code')}</p>
                <QRCodeCanvas value={setupInfo.otpauth_uri} size={152} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="mb-2 font-semibold">{t('Backup secret')}</p>
                <p className="rounded-xl bg-white p-3 text-sm font-mono tracking-wide text-slate-600">
                  {setupInfo.secret_masked}
                </p>
              </div>
            </div>
            <div>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                placeholder={t('Enter code from authenticator')}
                value={setupCode}
                onChange={(event) => setSetupCode(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-primary px-4 py-2"
                onClick={handleVerify2fa}
              >
                {t('Verify & enable')}
              </button>
              <button
                type="button"
                className="btn-secondary px-4 py-2"
                onClick={() => {
                  setSetupInfo(null);
                  setSetupCode('');
                }}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        )}

        {mfaEnabled && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{t('Use the form below to disable 2FA.')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                placeholder={t('Enter code from authenticator (preferred)')}
                value={disableForm.code}
                onChange={(event) =>
                  setDisableForm((prev) => ({ ...prev, code: event.target.value }))
                }
              />
              <input
                type="password"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                placeholder={t('Password (fallback)')}
                value={disableForm.password}
                onChange={(event) =>
                  setDisableForm((prev) => ({ ...prev, password: event.target.value }))
                }
              />
            </div>
            <button
              type="button"
              className="btn-secondary px-4 py-2"
              disabled={disableLoading}
              onClick={handleDisable2fa}
            >
              {disableLoading ? t('Disabling...') : t('Disable 2FA')}
            </button>
          </div>
        )}
      </div>

      <div className="panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Active sessions')}</h3>
            <p className="text-sm text-slate-500">
              {t('Revoke any device you no longer recognize.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-4 py-2"
              onClick={handleLogoutThis}
              disabled={sessionLoading.this}
            >
              {sessionLoading.this ? t('Revoking...') : t('Logout this device')}
            </button>
            <button
              type="button"
              className="btn-secondary px-4 py-2"
              onClick={handleLogoutAll}
              disabled={sessionLoading.all}
            >
              {sessionLoading.all ? t('Revoking...') : t('Logout from all devices')}
            </button>
          </div>
        </div>
        {sessionsError && <div className="text-sm text-red-600">{t(sessionsError)}</div>}
        {loadingSessions ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, idx) => (
              <div key={idx} className="h-20 rounded-xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-700">
                    {session.user_agent || t('Unknown device')}
                  </h4>
                  <span className="text-xs text-slate-400">
                    {session.id === currentSessionId ? t('This device') : ''}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {t('IP:')} {session.ip_address || t('Unknown')} {t('Created {{date}}', { date: new Date(session.created_at).toLocaleString() })}
                </p>
                <p className="text-xs text-slate-500">
                  {t('Last seen {{date}}', { date: new Date(session.last_seen_at).toLocaleString() })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
