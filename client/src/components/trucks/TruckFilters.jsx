import { useTranslation } from 'react-i18next';

export default function TruckFilters({
  filters,
  searchInput,
  onSearchChange,
  onFilterChange,
  onReset,
}) {
  const { t } = useTranslation();

  return (
    <div className="panel trucks-filters">
      <div className="trucks-filters-grid">
        <div className="filter-field">
          <label>{t('Search')}</label>
          <input
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('Truck code, plate, model, GPS IMEI')}
          />
        </div>
        <div className="filter-field">
          <label>{t('Status')}</label>
          <select
            value={filters.status}
            onChange={(e) => onFilterChange('status', e.target.value)}
          >
            <option value="">{t('All')}</option>
            <option value="Active">{t('Active')}</option>
            <option value="Inactive">{t('Inactive')}</option>
            <option value="Maintenance">{t('Maintenance')}</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('Fuel type')}</label>
          <select
            value={filters.fuel_type}
            onChange={(e) => onFilterChange('fuel_type', e.target.value)}
          >
            <option value="">{t('All')}</option>
            <option value="diesel">{t('diesel')}</option>
            <option value="petrol">{t('petrol')}</option>
            <option value="cng">{t('cng')}</option>
            <option value="electric">{t('electric')}</option>
            <option value="hybrid">{t('hybrid')}</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('Vehicle role')}</label>
          <select
            value={filters.vehicle_role}
            onChange={(e) => onFilterChange('vehicle_role', e.target.value)}
          >
            <option value="">{t('All')}</option>
            <option value="waste_truck">{t('Waste truck')}</option>
            <option value="support_car">{t('Support car')}</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('Ownership type')}</label>
          <select
            value={filters.ownership_type}
            onChange={(e) => onFilterChange('ownership_type', e.target.value)}
          >
            <option value="">{t('All')}</option>
            <option value="municipality_owned">{t('Municipality')}</option>
            <option value="rented">{t('Rented')}</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('From')}</label>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => onFilterChange('fromDate', e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label>{t('To')}</label>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => onFilterChange('toDate', e.target.value)}
          />
        </div>
      </div>
      <div className="trucks-filters-actions">
        <button type="button" className="btn-secondary btn-small" onClick={onReset}>
          {t('Reset')}
        </button>
      </div>
    </div>
  );
}
