import { useTranslation } from 'react-i18next';

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

export default function TruckDetailsPanel({
  truck,
  loading,
  liveMetrics,
  emissionsSummary,
  error,
}) {
  const { t } = useTranslation();

  if (!truck && !loading) {
    return (
      <div className="panel truck-details-panel">
        <h3>{t('Truck details')}</h3>
        <div className="empty-state">{t('Select a truck to view details')}</div>
      </div>
    );
  }

  return (
    <div className="panel truck-details-panel">
      <div className="truck-details-header">
        <div>
          <h3>{t('Truck details')}</h3>
          <div className="truck-details-subtitle">
            {truck ? truck.truck_code || t('Unnamed truck') : t('Loading...')}
          </div>
        </div>
        {truck && (
          <div className="chip-row">
            <span className={`status-chip status-chip--${String(truck.status || 'Active').toLowerCase()}`}>
              {t(truck.status || 'Active')}
            </span>
            <span className="fuel-chip">{t(truck.fuel_type || '-')}</span>
          </div>
        )}
      </div>

      {loading && <div className="loading-state">{t('Loading truck details...')}</div>}
      {!loading && error && <div className="inline-error">{error}</div>}

      {!loading && truck && (
        <>
          <div className="details-section">
            <div className="details-title">{t('Overview')}</div>
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">{t('Truck code')}</span>
                <span className="detail-value">{formatValue(truck.truck_code)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('Plate number')}</span>
                <span className="detail-value">{formatValue(truck.plate_number)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('Model')}</span>
                <span className="detail-value">{formatValue(truck.model)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('Capacity')}</span>
                <span className="detail-value">
                  {Number.isFinite(Number(truck.capacity_tons))
                    ? `${truck.capacity_tons} ${t('tons')}`
                    : '-'}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('GPS IMEI')}</span>
                <span className="detail-value">{formatValue(truck.gps_imei)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('Municipality')}</span>
                <span className="detail-value">{formatValue(truck.municipality_id)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t('Home center')}</span>
                <span className="detail-value">{formatValue(truck.home_center_id)}</span>
              </div>
            </div>
          </div>

          <div className="details-section">
            <div className="details-title">{t('Live metrics')}</div>
            {!liveMetrics && (
              <div className="empty-state">{t('No telemetry available')}</div>
            )}
            {liveMetrics && (
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">{t('Speed')}</span>
                  <span className="detail-value">
                    {formatValue(liveMetrics.speedKmh)} {t('km/h')}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('Distance')}</span>
                  <span className="detail-value">
                    {formatValue(liveMetrics.distanceLabel)}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('Last seen')}</span>
                  <span className="detail-value">{formatValue(liveMetrics.lastSeen)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="details-section">
            <div className="details-title">{t('Emissions summary')}</div>
            {!emissionsSummary && (
              <div className="empty-state">{t('Emissions data unavailable')}</div>
            )}
            {emissionsSummary && (
              <div className="details-grid">
                <div className="detail-item">
                  <span className="detail-label">{t('Estimated fuel')}</span>
                  <span className="detail-value">
                    {formatValue(emissionsSummary.fuelLiters)} {t('L')}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('CO₂')}</span>
                  <span className="detail-value">
                    {formatValue(emissionsSummary.co2Kg)} {t('kg')}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">{t('CO')}</span>
                  <span className="detail-value">
                    {formatValue(emissionsSummary.coKg)} {t('kg')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
