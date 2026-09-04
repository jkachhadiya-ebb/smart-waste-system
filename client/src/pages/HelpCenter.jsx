import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const HELP_SECTIONS = [
  {
    title: 'Getting started',
    description: 'Set up your municipality, trucks, and disposal locations in minutes.',
    items: [
      'Add trucks and assign roles',
      'Review live routes in the dashboard',
      'Configure disposal reporting',
    ],
  },
  {
    title: 'Daily operations',
    description: 'Stay on top of pickups, landfill capacity, and route updates.',
    items: [
      'Track route progress in real time',
      'Review disposal totals by truck',
      'Export reports for compliance',
    ],
  },
  {
    title: 'Notifications',
    description: 'Enable alerts to catch exceptions and route issues quickly.',
    items: [
      'Turn on in-app alerts in Settings',
      'Use email or SMS for critical updates',
      'Clear notifications from the header bell',
    ],
  },
];

export default function HelpCenter() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="help-center-container">
      <div className="filter-row help-center-header">
        <div className="help-center-title-block">
          <div className="dashboard-title">{t('Help Center')}</div>
          <p className="help-center-subtitle">
            {t('Quick answers, tips, and troubleshooting for your team.')}
          </p>
        </div>
        <div className="help-center-actions">
          <button
            className="btn-secondary btn-small"
            type="button"
            onClick={() => navigate('/settings')}
          >
            {t('Notification settings')}
          </button>
          <button
            className="btn-primary btn-small"
            type="button"
            onClick={() => navigate('/dashboard')}
          >
            {t('Back to dashboard')}
          </button>
        </div>
      </div>

      <div className="help-center-grid">
        {HELP_SECTIONS.map((section) => (
          <div key={section.title} className="panel help-center-card">
            <h3>{t(section.title)}</h3>
            <p>{t(section.description)}</p>
            <ul className="help-center-list">
              {section.items.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="panel help-center-contact">
        <div>
          <h3>{t('Need more help?')}</h3>
          <p>
            {t(
              'Contact your municipality administrator for account access, integrations, and data questions.'
            )}
          </p>
        </div>
        <div className="help-center-contact-actions">
          <button
            className="btn-secondary btn-small"
            type="button"
            onClick={() => navigate('/reports')}
          >
            {t('Open reports')}
          </button>
          <button
            className="btn-primary btn-small"
            type="button"
            onClick={() => navigate('/settings')}
          >
            {t('Open settings')}
          </button>
        </div>
      </div>
    </div>
  );
}
