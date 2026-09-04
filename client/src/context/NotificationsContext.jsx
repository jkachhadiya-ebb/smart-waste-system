import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchNotifications } from '../api/settingsApi.js';
import {
  fetchNotificationsFeed,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../api/notificationsApi.js';
import { AuthContext } from './AuthContext.jsx';

const NotificationsContext = createContext({
  channels: { inapp_enabled: false },
  eventTypes: [],
  prefs: {},
  loading: false,
  error: '',
  notifications: [],
  unreadCount: 0,
  notificationsLoading: false,
  notificationsError: '',
  refreshSettings: () => {},
  updateSettings: () => {},
  refreshNotifications: () => {},
  markAllRead: () => {},
  markRead: () => {},
});

export function NotificationsProvider({ children }) {
  const { user } = useContext(AuthContext);
  const [channels, setChannels] = useState({ inapp_enabled: false });
  const [eventTypes, setEventTypes] = useState([]);
  const [prefs, setPrefs] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');

  const updateSettings = useCallback((data) => {
    if (!data) return;
    if (data.channels) {
      setChannels(data.channels);
    }
    if (Array.isArray(data.eventTypes)) {
      setEventTypes(data.eventTypes);
    }
    if (data.prefs) {
      setPrefs(data.prefs);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    if (!user) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const { data } = await fetchNotifications();
      updateSettings(data);
    } catch (err) {
      console.error('Notifications context load failed', err);
      setSettingsError(err.response?.data?.message || 'Could not load notifications');
    } finally {
      setSettingsLoading(false);
    }
  }, [updateSettings, user]);

  const refreshNotifications = useCallback(
    async (options = {}) => {
      if (!user) return null;
      const limit = Number.isFinite(options.limit) ? options.limit : 8;
      const offset = Number.isFinite(options.offset) ? options.offset : 0;
      setNotificationsLoading(true);
      setNotificationsError('');
      try {
        const { data } = await fetchNotificationsFeed({ limit, offset });
        const list = Array.isArray(data?.notifications) ? data.notifications : [];
        const unread = Number.isFinite(data?.unreadCount) ? data.unreadCount : 0;
        setNotifications(list);
        setUnreadCount(unread);
        return { notifications: list, unreadCount: unread };
      } catch (err) {
        console.error('Notifications feed load failed', err);
        setNotificationsError(err.response?.data?.message || 'Could not load notifications');
        return null;
      } finally {
        setNotificationsLoading(false);
      }
    },
    [user]
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    try {
      await markAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((item) => (item.readAt ? item : { ...item, readAt: now }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Mark all notifications read failed', err);
    }
  }, [user]);

  const markRead = useCallback(
    async (ids = []) => {
      if (!user) return;
      const normalized = Array.isArray(ids)
        ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];
      if (!normalized.length) return;
      try {
        await markNotificationsRead(normalized);
        const now = new Date().toISOString();
        setNotifications((prev) => {
          const updated = prev.map((item) =>
            normalized.includes(item.id) && !item.readAt
              ? { ...item, readAt: now }
              : item
          );
          const unread = updated.filter((item) => !item.readAt).length;
          setUnreadCount(unread);
          return updated;
        });
      } catch (err) {
        console.error('Mark notifications read failed', err);
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) {
      setChannels({ inapp_enabled: false });
      setEventTypes([]);
      setPrefs({});
      setSettingsLoading(false);
      setSettingsError('');
      setNotifications([]);
      setUnreadCount(0);
      setNotificationsLoading(false);
      setNotificationsError('');
      return;
    }
    refreshSettings();
    refreshNotifications();
  }, [refreshSettings, refreshNotifications, user]);

  useEffect(() => {
    if (!user) return undefined;
    const interval = setInterval(() => {
      refreshNotifications();
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshNotifications, user]);

  const value = useMemo(
    () => ({
      channels,
      eventTypes,
      prefs,
      loading: settingsLoading,
      error: settingsError,
      notifications,
      unreadCount,
      notificationsLoading,
      notificationsError,
      refreshSettings,
      updateSettings,
      refreshNotifications,
      markAllRead,
      markRead,
    }),
    [
      channels,
      eventTypes,
      prefs,
      settingsLoading,
      settingsError,
      notifications,
      unreadCount,
      notificationsLoading,
      notificationsError,
      refreshSettings,
      updateSettings,
      refreshNotifications,
      markAllRead,
      markRead,
    ]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
