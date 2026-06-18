import { useMemo, useState } from 'react';
import ProfileTab from '../components/settings/ProfileTab.jsx';
import GeneralTab from '../components/settings/GeneralTab.jsx';
import NotificationsTab from '../components/settings/NotificationsTab.jsx';
import SecurityTab from '../components/settings/SecurityTab.jsx';
import { useTranslation } from 'react-i18next';

const RAW_TABS = [
  {
    key: 'profile',
    label: 'Profile',
    description: 'Municipality contact data, logo, and map pin controls.',
  },
  {
    key: 'general',
    label: 'General',
    description: 'Personalize your appearance and dashboard map preferences.',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'Choose notification channels and alert types.',
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Password, 2FA, and active session handling.',
  },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('profile');
  const [dirtyState, setDirtyState] = useState({
    profile: false,
    general: false,
    notifications: false,
    security: false,
  });
  const [forceRefresh, setForceRefresh] = useState({
    profile: 0,
    general: 0,
    notifications: 0,
    security: 0,
  });
  const TABS = useMemo(
    () =>
      RAW_TABS.map((tab) => ({
        ...tab,
        label: t(tab.label),
        description: t(tab.description),
      })),
    [t]
  );
  const labelByKey = useMemo(() => {
    return TABS.reduce((acc, tab) => {
      acc[tab.key] = tab.label;
      return acc;
    }, {});
  }, [TABS]);
  const [pendingTab, setPendingTab] = useState(null);

  const handleTabChange = (target) => {
    if (target === activeTab) return;
    if (dirtyState[activeTab]) {
      setPendingTab(target);
      return;
    }
    setActiveTab(target);
  };

  const discardChangesAndSwitch = () => {
    setDirtyState((prev) => ({ ...prev, [activeTab]: false }));
    setForceRefresh((prev) => ({ ...prev, [activeTab]: prev[activeTab] + 1 }));
    setActiveTab(pendingTab);
    setPendingTab(null);
  };

  const cancelDiscard = () => setPendingTab(null);

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'profile':
        return (
          <ProfileTab
            forceRefreshKey={forceRefresh.profile}
            onDirtyChange={(state) =>
              setDirtyState((prev) => ({ ...prev, profile: state }))
            }
          />
        );
      case 'general':
        return (
          <GeneralTab
            forceRefreshKey={forceRefresh.general}
            onDirtyChange={(state) =>
              setDirtyState((prev) => ({ ...prev, general: state }))
            }
          />
        );
      case 'notifications':
        return (
          <NotificationsTab
            forceRefreshKey={forceRefresh.notifications}
            onDirtyChange={(state) =>
              setDirtyState((prev) => ({ ...prev, notifications: state }))
            }
          />
        );
      case 'security':
        return (
          <SecurityTab
            forceRefreshKey={forceRefresh.security}
            onDirtyChange={(state) =>
              setDirtyState((prev) => ({ ...prev, security: state }))
            }
          />
        );
      default:
        return null;
    }
  }, [activeTab, forceRefresh]);

  const confirmMessage = useMemo(() => {
    if (!pendingTab) return '';
    const activeLabel = labelByKey[activeTab] || activeTab;
    const pendingLabel = labelByKey[pendingTab] || pendingTab;
    return t('You have unsaved changes on the {{active}} tab. Discard and switch to {{pending}}?', {
      active: activeLabel,
      pending: pendingLabel,
    });
  }, [activeTab, labelByKey, pendingTab, t]);

  return (
    <div>
      <div className="settings-page">
        <div className="space-y-6 rounded-[30px] bg-white px-6 py-6 shadow-lg shadow-slate-300/30 lg:px-8">
          <div className="space-y-1">
            <h2 className="settings-title">{t('System settings')}</h2>
            <p className="text-sm text-slate-500">
              {t('Fine-tune your account, map defaults, notifications, and security.')}
            </p>
          </div>

          <div className="w-full rounded-[32px] bg-slate-100 p-1">
            <div className="flex w-full gap-2 rounded-[28px] bg-white/80 p-1">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleTabChange(tab.key)}
                    aria-pressed={isActive}
                    className={`flex-1 rounded-[26px] px-5 py-3 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-sky-200 text-slate-900 shadow-inner shadow-slate-200'
                        : 'bg-white text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200/60">
              <p className="text-sm text-slate-600 italic">
                {TABS.find(t => t.key === activeTab)?.description}
              </p>
            </div>
            {tabContent}
          </div>
        </div>
      </div>

      {pendingTab && (
        <div className="modal-backdrop">
          <div className="modal max-w-lg">
            <h2>{t('Unsaved changes')}</h2>
            <p className="text-sm text-slate-600">{confirmMessage}</p>
            <div className="modal-footer">
              <button type="button" className="btn-secondary px-4 py-2" onClick={cancelDiscard}>
                {t('Stay on {{tab}}', { tab: labelByKey[activeTab] || activeTab })}
              </button>
              <button type="button" className="btn-primary px-4 py-2" onClick={discardChangesAndSwitch}>
                {t('Discard and switch')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
