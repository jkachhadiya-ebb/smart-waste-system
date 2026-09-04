import { useTranslation } from 'react-i18next';
import { normalizeOwnershipType } from '../../utils/ownership.js';
import { resolveVehicleRoleFromTruck } from '../../utils/vehicleRole.js';

function statusClass(status) {
  const key = String(status || 'Active').toLowerCase();
  if (key === 'inactive') return 'status-chip status-chip--inactive';
  if (key === 'maintenance') return 'status-chip status-chip--maintenance';
  return 'status-chip status-chip--active';
}

function fuelLabel(value) {
  const text = String(value || '').toLowerCase();
  return text ? text : '-';
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '-';
  if (!Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

export default function TruckTable({
  trucks,
  loading,
  page,
  totalPages,
  totalCount,
  onPageChange,
  onViewTruck,
  onEditTruck,
  onDeleteTruck,
  sortField,
  sortOrder,
  onSortChange,
  metricsById,
}) {
  const { t } = useTranslation();
  const hasRows = Array.isArray(trucks) && trucks.length > 0;

  function sortIndicator(field) {
    if (sortField !== field) return '';
    return sortOrder === 'desc' ? '▼' : '▲';
  }

  function sortAria(field) {
    if (sortField !== field) return 'none';
    return sortOrder === 'desc' ? 'descending' : 'ascending';
  }

  return (
    <div className="truck-table-wrapper">
      <table className="truck-table">
        <thead>
          <tr>
            <th aria-sort={sortAria('truck_code')}>
              <button type="button" className="table-sort" onClick={() => onSortChange('truck_code')}>
                {t('Truck code')}
                <span className="sort-indicator">{sortIndicator('truck_code')}</span>
              </button>
            </th>
            <th>{t('Plate number')}</th>
            <th>{t('Role')}</th>
            <th>{t('Ownership')}</th>
            <th aria-sort={sortAria('status')}>
              <button type="button" className="table-sort" onClick={() => onSortChange('status')}>
                {t('Status')}
                <span className="sort-indicator">{sortIndicator('status')}</span>
              </button>
            </th>
            <th aria-sort={sortAria('fuel_type')}>
              <button type="button" className="table-sort" onClick={() => onSortChange('fuel_type')}>
                {t('Fuel type')}
                <span className="sort-indicator">{sortIndicator('fuel_type')}</span>
              </button>
            </th>
            <th>{t('GPS')}</th>
            <th>{t('Today distance')}</th>
            <th>{t('Today fuel')}</th>
            <th aria-sort={sortAria('today_co2')}>
              <button type="button" className="table-sort" onClick={() => onSortChange('today_co2')}>
                {t('Today CO₂')}
                <span className="sort-indicator">{sortIndicator('today_co2')}</span>
              </button>
            </th>
            <th>{t('Actions')}</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={11}>
                <div className="table-empty">{t('Loading trucks...')}</div>
              </td>
            </tr>
          )}

          {!loading && !hasRows && (
            <tr>
              <td colSpan={11}>
                <div className="table-empty">{t('No trucks found')}</div>
              </td>
            </tr>
          )}

          {!loading &&
            hasRows &&
            trucks.map((truck) => {
              const status = truck.status || 'Active';
              const fuel = fuelLabel(truck.fuel_type);
              const roleKey = resolveVehicleRoleFromTruck(truck);
              const ownershipKey = normalizeOwnershipType(truck.ownership_type, {
                fallback: 'municipality_owned',
              });
              const metrics = metricsById?.[truck.id] || {};
              const gpsStatus = metrics.gpsStatus || 'unknown';
              const lastSeen = metrics.lastSeen || '-';
              const todayFuel = metrics.todayFuel;
              const fuelUnit = metrics.fuelUnit || 'L';

              return (
                <tr
                  key={truck.id}
                  className="truck-row"
                  onClick={() => onViewTruck(truck)}
                >
                  <td>{truck.truck_code || '-'}</td>
                  <td>{truck.plate_number || '-'}</td>
                  <td>
                    <span
                      className={
                        roleKey === 'support_car'
                          ? 'role-chip role-chip--support'
                          : 'role-chip role-chip--waste'
                      }
                    >
                      {roleKey === 'support_car' ? t('Support car') : t('Waste truck')}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        ownershipKey === 'rented'
                          ? 'ownership-chip ownership-chip--rented'
                          : 'ownership-chip ownership-chip--municipality'
                      }
                    >
                      {ownershipKey === 'rented' ? t('Rented') : t('Municipality')}
                    </span>
                  </td>
                  <td>
                    <span className={statusClass(status)}>{t(status)}</span>
                  </td>
                  <td>
                    <span className="fuel-chip">{t(fuel)}</span>
                  </td>
                  <td>
                    <div className="gps-cell">
                      <div>{truck.gps_imei || '-'}</div>
                      <div className="gps-meta">
                        <span className={`gps-dot gps-dot--${gpsStatus}`} />
                        <span>{lastSeen}</span>
                      </div>
                    </div>
                  </td>
                  <td>{formatNumber(metrics.todayDistanceKm, 2)}</td>
                  <td>
                    {Number.isFinite(Number(todayFuel))
                      ? `${formatNumber(todayFuel, 2)} ${fuelUnit}`
                      : '-'}
                  </td>
                  <td>{formatNumber(metrics.todayCo2Kg, 2)}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="table-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewTruck(truck);
                        }}
                      >
                        {t('View')}
                      </button>
                      <button
                        type="button"
                        className="table-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTruck(truck);
                        }}
                      >
                        {t('Edit')}
                      </button>
                      <button
                        type="button"
                        className="table-action table-action--danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTruck(truck);
                        }}
                      >
                        {t('Delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="table-pagination">
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('Previous')}
          </button>
          <div className="pagination-label">
            {t('Page {{page}} of {{total}}', { page, total: totalPages })}
            {Number.isFinite(Number(totalCount)) ? ` | ${t('{{count}} total', { count: totalCount })}` : ''}
          </div>
          <button
            type="button"
            className="btn-secondary btn-small"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('Next')}
          </button>
        </div>
      )}
    </div>
  );
}
