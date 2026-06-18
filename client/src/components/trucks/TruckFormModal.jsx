import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DEFAULT_FORM = {
  truck_code: '',
  plate_number: '',
  model: '',
  capacity_tons: '',
  gps_imei: '',
  status: 'Active',
  fuel_type: 'diesel',
  co2_factor_per_liter: '',
  co_factor_per_liter: '',
  municipality_id: '',
  home_center_id: '',
  vehicle_role: 'waste_truck',
  ownership_type: 'municipality_owned',
  fuel_efficiency_km_per_liter: '',
  fuel_efficiency_kwh_per_km: '',
};

function normalizeFormValues(data) {
  if (!data) return { ...DEFAULT_FORM };
  return {
    ...DEFAULT_FORM,
    truck_code: data.truck_code ?? '',
    plate_number: data.plate_number ?? '',
    model: data.model ?? '',
    capacity_tons: data.capacity_tons ?? '',
    gps_imei: data.gps_imei ?? '',
    status: data.status ?? 'Active',
    fuel_type: data.fuel_type ?? 'diesel',
    co2_factor_per_liter: data.co2_factor_per_liter ?? '',
    co_factor_per_liter: data.co_factor_per_liter ?? '',
    municipality_id: data.municipality_id ?? '',
    home_center_id: data.home_center_id ?? '',
    vehicle_role: data.vehicle_role ?? 'waste_truck',
    ownership_type: data.ownership_type ?? 'municipality_owned',
    fuel_efficiency_km_per_liter: data.fuel_efficiency_km_per_liter ?? '',
    fuel_efficiency_kwh_per_km: data.fuel_efficiency_kwh_per_km ?? '',
  };
}

function isNumberValue(value) {
  if (value === '' || value === null || value === undefined) return true;
  return Number.isFinite(Number(value));
}

export default function TruckFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  saving,
  municipalities = [],
  homeCenters = [],
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (isOpen) {
      setForm(normalizeFormValues(initialData));
      setErrors({});
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  function updateField(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  const isElectric = String(form.fuel_type || '').toLowerCase() === 'electric';

  function validate() {
    const nextErrors = {};
    if (!String(form.truck_code || '').trim()) {
      nextErrors.truck_code = t('Truck code is required');
    }
    if (!String(form.fuel_type || '').trim()) {
      nextErrors.fuel_type = t('Fuel type is required');
    }
    if (!isNumberValue(form.capacity_tons)) {
      nextErrors.capacity_tons = t('Capacity must be a number');
    }
    if (isElectric) {
      if (!String(form.fuel_efficiency_kwh_per_km || '').trim()) {
        nextErrors.fuel_efficiency_kwh_per_km = t('kWh per km is required for electric vehicles');
      } else if (!isNumberValue(form.fuel_efficiency_kwh_per_km)) {
        nextErrors.fuel_efficiency_kwh_per_km = t('kWh per km must be a number');
      }
    } else {
      if (!String(form.fuel_efficiency_km_per_liter || '').trim()) {
        nextErrors.fuel_efficiency_km_per_liter = t('Km per liter is required');
      } else if (!isNumberValue(form.fuel_efficiency_km_per_liter)) {
        nextErrors.fuel_efficiency_km_per_liter = t('Km per liter must be a number');
      }
    }
    if (!isNumberValue(form.co2_factor_per_liter)) {
      nextErrors.co2_factor_per_liter = t('CO2 factor must be a number');
    }
    if (!isNumberValue(form.co_factor_per_liter)) {
      nextErrors.co_factor_per_liter = t('CO factor must be a number');
    }
    if (!isNumberValue(form.municipality_id)) {
      nextErrors.municipality_id = t('Municipality ID must be a number');
    }
    if (!isNumberValue(form.home_center_id)) {
      nextErrors.home_center_id = t('Home center ID must be a number');
    }
    return nextErrors;
  }

  function buildPayload() {
    const efficiencyKmPerLiter =
      form.fuel_efficiency_km_per_liter === '' ? null : Number(form.fuel_efficiency_km_per_liter);
    const efficiencyKwhPerKm =
      form.fuel_efficiency_kwh_per_km === '' ? null : Number(form.fuel_efficiency_kwh_per_km);

    const payload = {
      truck_code: String(form.truck_code || '').trim(),
      plate_number: String(form.plate_number || '').trim() || null,
      model: String(form.model || '').trim() || null,
      capacity_tons: form.capacity_tons === '' ? null : Number(form.capacity_tons),
      gps_imei: String(form.gps_imei || '').trim() || null,
      status: form.status || null,
      fuel_type: String(form.fuel_type || '').trim().toLowerCase(),
      vehicle_role: String(form.vehicle_role || '').trim().toLowerCase() || null,
      ownership_type: String(form.ownership_type || '').trim().toLowerCase() || null,
      co2_factor_per_liter:
        form.co2_factor_per_liter === '' ? null : Number(form.co2_factor_per_liter),
      co_factor_per_liter:
        form.co_factor_per_liter === '' ? null : Number(form.co_factor_per_liter),
      municipality_id:
        form.municipality_id === '' ? null : Number(form.municipality_id),
      home_center_id: form.home_center_id === '' ? null : Number(form.home_center_id),
      fuel_efficiency_km_per_liter: isElectric ? null : efficiencyKmPerLiter,
      fuel_efficiency_kwh_per_km: isElectric ? efficiencyKwhPerKm : null,
    };

    Object.keys(payload).forEach((key) => {
      if (Number.isNaN(payload[key])) {
        payload[key] = null;
      }
    });
    return payload;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validation = validate();
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    const payload = buildPayload();
    await onSubmit(payload);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide">
        <h2>{initialData ? t('Edit truck') : t('Add truck')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Truck code')}</label>
                <input
                  name="truck_code"
                  value={form.truck_code}
                  onChange={updateField}
                  className={errors.truck_code ? 'invalid' : ''}
                />
                {errors.truck_code && <div className="error-msg">{errors.truck_code}</div>}
              </div>
              <div className="modal-field">
                <label>{t('Plate number')}</label>
                <input
                  name="plate_number"
                  value={form.plate_number}
                  onChange={updateField}
                />
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Model')}</label>
                <input name="model" value={form.model} onChange={updateField} />
              </div>
              <div className="modal-field">
                <label>{t('Capacity (tons)')}</label>
                <input
                  name="capacity_tons"
                  value={form.capacity_tons}
                  onChange={updateField}
                  className={errors.capacity_tons ? 'invalid' : ''}
                />
                {errors.capacity_tons && (
                  <div className="error-msg">{errors.capacity_tons}</div>
                )}
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('GPS IMEI')}</label>
                <input name="gps_imei" value={form.gps_imei} onChange={updateField} />
              </div>
              <div className="modal-field">
                <label>{t('Status')}</label>
                <select name="status" value={form.status} onChange={updateField}>
                  <option value="Active">{t('Active')}</option>
                  <option value="Inactive">{t('Inactive')}</option>
                  <option value="Maintenance">{t('Maintenance')}</option>
                </select>
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Fuel type')}</label>
                <select
                  name="fuel_type"
                  value={form.fuel_type}
                  onChange={updateField}
                  className={errors.fuel_type ? 'invalid' : ''}
                >
                  <option value="diesel">{t('diesel')}</option>
                  <option value="petrol">{t('petrol')}</option>
                  <option value="cng">{t('cng')}</option>
                  <option value="electric">{t('electric')}</option>
                  <option value="hybrid">{t('hybrid')}</option>
                </select>
                {errors.fuel_type && <div className="error-msg">{errors.fuel_type}</div>}
              </div>
              <div className="modal-field">
                <label>{t('Vehicle role')}</label>
                <select name="vehicle_role" value={form.vehicle_role} onChange={updateField}>
                  <option value="waste_truck">{t('Waste truck')}</option>
                  <option value="support_car">{t('Support car')}</option>
                </select>
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Ownership type')}</label>
                <select name="ownership_type" value={form.ownership_type} onChange={updateField}>
                  <option value="municipality_owned">{t('Municipality')}</option>
                  <option value="rented">{t('Rented')}</option>
                </select>
              </div>
              <div className="modal-field">
                <label>
                  {isElectric ? t('Fuel efficiency (kWh/km)') : t('Fuel efficiency (km/L)')}
                </label>
                <input
                  name={isElectric ? 'fuel_efficiency_kwh_per_km' : 'fuel_efficiency_km_per_liter'}
                  value={
                    isElectric ? form.fuel_efficiency_kwh_per_km : form.fuel_efficiency_km_per_liter
                  }
                  onChange={updateField}
                  className={
                    isElectric
                      ? errors.fuel_efficiency_kwh_per_km
                        ? 'invalid'
                        : ''
                      : errors.fuel_efficiency_km_per_liter
                        ? 'invalid'
                        : ''
                  }
                />
                {isElectric && errors.fuel_efficiency_kwh_per_km && (
                  <div className="error-msg">{errors.fuel_efficiency_kwh_per_km}</div>
                )}
                {!isElectric && errors.fuel_efficiency_km_per_liter && (
                  <div className="error-msg">{errors.fuel_efficiency_km_per_liter}</div>
                )}
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('CO₂ factor per liter')}</label>
                <input
                  name="co2_factor_per_liter"
                  value={form.co2_factor_per_liter}
                  onChange={updateField}
                  className={errors.co2_factor_per_liter ? 'invalid' : ''}
                />
                {errors.co2_factor_per_liter && (
                  <div className="error-msg">{errors.co2_factor_per_liter}</div>
                )}
              </div>
              <div className="modal-field">
                <label>{t('CO factor per liter')}</label>
                <input
                  name="co_factor_per_liter"
                  value={form.co_factor_per_liter}
                  onChange={updateField}
                  className={errors.co_factor_per_liter ? 'invalid' : ''}
                />
                {errors.co_factor_per_liter && (
                  <div className="error-msg">{errors.co_factor_per_liter}</div>
                )}
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Municipality ID')}</label>
                {municipalities.length > 0 ? (
                  <select
                    name="municipality_id"
                    value={form.municipality_id}
                    onChange={updateField}
                    className={errors.municipality_id ? 'invalid' : ''}
                  >
                    <option value="">{t('Select')}</option>
                    {municipalities.map((municipality) => (
                      <option key={municipality.id} value={municipality.id}>
                        {municipality.name || municipality.municipality_code || municipality.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="municipality_id"
                    value={form.municipality_id}
                    onChange={updateField}
                    className={errors.municipality_id ? 'invalid' : ''}
                  />
                )}
                {errors.municipality_id && (
                  <div className="error-msg">{errors.municipality_id}</div>
                )}
              </div>
            </div>

            <div className="modal-row">
              <div className="modal-field">
                <label>{t('Home center ID')}</label>
                {homeCenters.length > 0 ? (
                  <select
                    name="home_center_id"
                    value={form.home_center_id}
                    onChange={updateField}
                    className={errors.home_center_id ? 'invalid' : ''}
                  >
                    <option value="">{t('Select')}</option>
                    {homeCenters.map((center) => (
                      <option key={center.id} value={center.id}>
                        {center.name || center.center_code || center.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="home_center_id"
                    value={form.home_center_id}
                    onChange={updateField}
                    className={errors.home_center_id ? 'invalid' : ''}
                  />
                )}
                {errors.home_center_id && (
                  <div className="error-msg">{errors.home_center_id}</div>
                )}
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              {t('Cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? t('Saving...') : t('Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
