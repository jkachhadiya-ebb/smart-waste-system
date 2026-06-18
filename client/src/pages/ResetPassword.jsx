import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import logo from '../assets/logo.png';

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const t = searchParams.get('token');
    if (t) {
      setToken(t);
    } else {
      setError('Missing reset token');
    }
  }, [searchParams]);

  // derived validation flags
  const hasLower = /[a-z]/.test(newPassword);
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasLength = newPassword.length >= 8;
  const passwordsMatch =
    newPassword.length > 0 && confirm.length > 0 && newPassword === confirm;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Missing reset token');
      return;
    }

    // frontend validation (same as backend logic)
    if (!hasLower || !hasUpper || !hasNumber || !hasLength) {
      setError(
        'Password must contain at least 8 characters, including lowercase, uppercase, and a number.'
      );
      return;
    }

    if (!passwordsMatch) {
      setError('New password and confirm password do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post('/auth/reset-password', {
        token,
        newPassword
      });
      setMessage(res.data.message || 'Password updated');

      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login-page">
      {/* Same background as login/forgot */}
      <div className="login-background">
        <div className="bg-circle bg-circle-1" />
        <div className="bg-circle bg-circle-2" />
        <div className="bg-circle bg-circle-3" />
        <div className="bg-icon bg-truck">🚛</div>
        <div className="bg-icon bg-bin">🗑️</div>
        <div className="bg-icon bg-leaf">🌿</div>
      </div>

      <div className="login-wrapper">
        <div className="login-logo-block">
          <img src={logo} alt={t('Smart Waste Logo')} className="login-logo-image" />
        </div>

        <div className="login-card">
          <h2>{t('Reset password')}</h2>

          <form onSubmit={handleSubmit}>
            {/* new password + toggle */}
            <label className="login-label">
              {t('New password')}
              <div className="password-input-wrapper">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('New password')}
                  required
                />
                <button
                  type="button"
                  className="show-password-btn"
                  onClick={() => setShowNew((v) => !v)}
                >
                  {showNew ? t('Hide') : t('Show')}
                </button>
              </div>
            </label>

            {/* confirm password + toggle */}
            <label className="login-label">
              {t('Confirm password')}
              <div className="password-input-wrapper">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('Confirm password')}
                  required
                />
                <button
                  type="button"
                  className="show-password-btn"
                  onClick={() => setShowConfirm((v) => !v)}
                >
                  {showConfirm ? t('Hide') : t('Show')}
                </button>
              </div>
            </label>

            {/* password rules */}
            <div className="password-rules">
              <h3>{t('Password must contain the following:')}</h3>
              <p className={hasLower ? 'valid' : 'invalid'}>{t('A lowercase letter')}</p>
              <p className={hasUpper ? 'valid' : 'invalid'}>{t('A capital (uppercase) letter')}</p>
              <p className={hasNumber ? 'valid' : 'invalid'}>{t('A number')}</p>
              <p className={hasLength ? 'valid' : 'invalid'}>{t('Minimum 8 characters')}</p>
              {confirm && (
                <p className={passwordsMatch ? 'valid' : 'invalid'}>
                  {t('New and confirm password must match')}
                </p>
              )}
            </div>

            {error && <div className="error">{t(error)}</div>}
            {message && <div className="info-message">{t(message)}</div>}

            <button type="submit" className="login-btn" disabled={saving}>
              {saving ? t('Saving...') : t('Update password')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
