import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useDirtyGuard from '../../hooks/useDirtyGuard.js';
import { fetchNotifications, saveNotifications } from '../../api/settingsApi.js';
import { useNotifications } from '../../context/NotificationsContext.jsx';

export default function NotificationsTab({ forceRefreshKey, onDirtyChange }) {
  const { t } = useTranslation();
  const { updateSettings } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState({
    email_enabled: true,
    sms_enabled: false,
    inapp_enabled: false,
    gps_offline_minutes: 15,
  });
  const [eventTypes, setEventTypes] = useState([]);
  const [prefs, setPrefs] = useState({});
  const initialRef = useRef(null);

  const loadNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchNotifications();
      setChannels({
        email_enabled: data.channels.email_enabled,
        sms_enabled: data.channels.sms_enabled,
        inapp_enabled: data.channels.inapp_enabled,
        gps_offline_minutes: data.channels.gps_offline_minutes,
      });
      setEventTypes(data.eventTypes || []);
      setPrefs(data.prefs || {});
      updateSettings(data);
      initialRef.current = {
        channels: {
          email_enabled: data.channels.email_enabled,
          sms_enabled: data.channels.sms_enabled,
          inapp_enabled: data.channels.inapp_enabled,
          gps_offline_minutes: data.channels.gps_offline_minutes,
        },
        prefs: data.prefs || {},
      };
    } catch (err) {
      console.error('Notifications load failed', err);
      setError(err.response?.data?.message || 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [forceRefreshKey]);

  const isDirty = useMemo(() => {
    if (!initialRef.current) return false;
    return (
      JSON.stringify(initialRef.current.channels) !== JSON.stringify(channels) ||
      JSON.stringify(initialRef.current.prefs) !== JSON.stringify(prefs)
    );
  }, [channels, prefs]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useDirtyGuard(isDirty);

  const handleTogglePref = (key) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveNotifications({
        channels,
        eventPrefs: eventTypes.map((event) => ({
          event_key: event.key,
          enabled: prefs[event.key] ?? true,
        })),
      });
      toast.success(t('Notification preferences saved'));
      loadNotifications();
    } catch (err) {
      console.error('Save notifications failed', err);
      toast.error(t(err.response?.data?.message || 'Could not save notifications'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 rounded-xl bg-slate-200 animate-pulse" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-20 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-20 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-20 rounded-xl bg-slate-200 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-600">{t(error)}</div>}

      <div className="panel space-y-4">
        <h3 className="text-lg font-semibold text-slate-700">{t('Notification channels')}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { key: 'email_enabled', label: 'Email alerts' },
            { key: 'sms_enabled', label: 'SMS alerts' },
            { key: 'inapp_enabled', label: 'In-app alerts' },
          ].map((item) => (
            <label key={item.key} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={channels[item.key]}
                onChange={(event) =>
                  setChannels((prev) => ({ ...prev, [item.key]: event.target.checked }))
                }
              />
              {t(item.label)}
            </label>
          ))}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('GPS offline minutes')}
            </label>
            <input
              type="number"
              min="1"
              max="4320"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              value={channels.gps_offline_minutes}
              onChange={(event) =>
                setChannels((prev) => ({ ...prev, gps_offline_minutes: Number(event.target.value) }))
              }
            />
          </div>
        </div>
      </div>

      <div className="panel space-y-3">
        <h3 className="text-lg font-semibold text-slate-700">{t('Alert types')}</h3>
        <div className="space-y-2">
          {eventTypes.map((event) => (
            <label key={event.key} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
              <input
                type="checkbox"
                checked={prefs[event.key] ?? true}
                onChange={() => handleTogglePref(event.key)}
              />
              <span className="text-sm text-slate-700">{t(event.label)}</span>
            </label>
          ))}
        </div>
        {prefs.gps_offline && (
          <div className="text-sm text-slate-500">
            {t('GPS offline threshold is {{minutes}} minutes.', {
              minutes: channels.gps_offline_minutes,
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn-primary px-5 py-2"
        disabled={!isDirty || saving}
        onClick={handleSave}
      >
        {saving ? t('Saving...') : t('Save notification settings')}
      </button>
    </div>
  );
}

