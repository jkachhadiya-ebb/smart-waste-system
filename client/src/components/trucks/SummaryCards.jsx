import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '\u2014';
  if (!Number.isFinite(Number(value))) return '\u2014';
  return Number(value).toFixed(digits);
}

export default function SummaryCards({
  activeCount,
  wasteCount,
  supportCount,
  co2WeekKg,
  loadingCo2,
}) {
  const { t } = useTranslation();
  const co2Display = useMemo(() => {
    if (loadingCo2) return t('Loading...');
    return formatNumber(co2WeekKg, 2);
  }, [co2WeekKg, loadingCo2, t]);

  return (
    <div className="trucks-summary-grid">
      <div className="summary-card">
        <div className="summary-card-label">{t('Active vehicles')}</div>
        <div className="summary-card-value">{activeCount}</div>
      </div>
      <div className="summary-card">
        <div className="summary-card-label">{t('Waste trucks')}</div>
        <div className="summary-card-value">{wasteCount}</div>
      </div>
      <div className="summary-card">
        <div className="summary-card-label">{t('Support cars')}</div>
        <div className="summary-card-value">{supportCount}</div>
      </div>
      <div className="summary-card">
        <div className="summary-card-label">{t('Total CO₂ this week')}</div>
        <div className="summary-card-value">{co2Display}</div>
        <div className="summary-card-sub">{t('kg')}</div>
      </div>
    </div>
  );
}
