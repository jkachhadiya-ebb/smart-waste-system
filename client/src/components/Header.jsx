import '../styles/Header.css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/logo.png';
import { useNotifications } from '../context/NotificationsContext.jsx';

export default function Header({ collapsed, onToggle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    channels,
    notifications,
    unreadCount,
    notificationsLoading,
    notificationsError,
    refreshNotifications,
    markAllRead,
  } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);
  const toggleIcon = collapsed ? '☰' : '✕';
  const inAppEnabled = Boolean(channels?.inapp_enabled);

  const showNotificationDot = inAppEnabled && unreadCount > 0;

  useEffect(() => {
    if (!notificationsOpen) return;
    const handleOutside = (event) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [notificationsOpen]);

  const handleNotificationsClick = async () => {
    if (!notificationsOpen) {
      const result = await refreshNotifications();
      if (inAppEnabled && result?.unreadCount) {
        await markAllRead();
      }
    }
    setNotificationsOpen((prev) => !prev);
  };

  const formatNotificationTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  };

  const renderNotificationBody = () => {
    if (!inAppEnabled) {
      return (
        <p className="notification-popover-text">
          {t('Turn on In-app alerts in Settings to see notifications here.')}
        </p>
      );
    }
    if (notificationsLoading) {
      return <p className="notification-popover-text">{t('Loading notifications...')}</p>;
    }
    if (notificationsError) {
      return <p className="notification-popover-text">{t(notificationsError)}</p>;
    }
    if (!notifications.length) {
      return (
        <p className="notification-popover-text">
          {t('No notifications yet.')}
        </p>
      );
    }
    return (
      <div className="notification-list">
        {notifications.map((item) => (
          <div
            key={item.id}
            className={`notification-item ${item.readAt ? '' : 'notification-item--unread'}`}
          >
            <div className="notification-item-title">{item.title}</div>
            <div className="notification-item-message">{item.message}</div>
            <div className="notification-item-time">
              {formatNotificationTime(item.createdAt)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const handleHelpClick = () => {
    setNotificationsOpen(false);
    navigate('/help-center');
  };

  return (
    <header className="app-header">
      <div className="app-header-left">
        {/* ƒ? Sidebar toggle in the left corner */}
        <button
          className="header-toggle"
          onClick={onToggle}
          aria-label={t('Toggle sidebar')}
        >
          <span className="toggle-icon">{toggleIcon}</span>
        </button>

        <div>
          <img src={logo} alt={t('Smart Waste Logo')} className="app-header-logo" />
        </div>
      </div>
      <div className="app-header-right flex gap-2">
        <div className="notification-cluster" ref={notificationsRef}>
          <button
            className="p-2 hover:bg-gray-100 rounded-lg transition"
            type="button"
            title={t('Notifications')}
            aria-label={t('Notifications')}
            aria-haspopup="dialog"
            aria-expanded={notificationsOpen}
            onClick={handleNotificationsClick}
          >
            <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.46 5.36 5.82 7.93 5.82 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
            {showNotificationDot && <span className="notification-dot" aria-hidden="true" />}
          </button>
          {notificationsOpen && (
            <div className="notification-popover" role="dialog" aria-label={t('Notifications')}>
              <div className="notification-popover-header">
                <span className="notification-popover-title">{t('Notifications')}</span>
                <span className="notification-popover-status">
                  {inAppEnabled
                    ? unreadCount
                      ? t('{{count}} new', { count: unreadCount })
                      : t('All caught up')
                    : t('In-app off')}
                </span>
              </div>
              {renderNotificationBody()}
            </div>
          )}
        </div>
        <button
          className="p-2 hover:bg-gray-100 rounded-lg transition"
          type="button"
          title={t('Help')}
          aria-label={t('Help')}
          onClick={handleHelpClick}
        >
          <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
