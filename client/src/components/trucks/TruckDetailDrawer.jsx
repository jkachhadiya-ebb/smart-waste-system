import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TruckMap from './TruckMap.jsx';
import {
  fetchTruckById,
  fetchTruckTelemetryLatest,
  fetchTruckTelemetryWindow,
  fetchTruckTrips,
  fetchTruckEmissions,
  fetchTruckWasteLoadEvents,
  fetchTruckRental,
} from '../../api/trucks.js';
import {
  normalizeTelemetryLatest,
  normalizeTelemetryWindow,
  resolveTelemetryCoords,
} from '../../utils/telemetry.js';
import { normalizeOwnershipType } from '../../utils/ownership.js';
import { resolveVehicleRoleFromTruck } from '../../utils/vehicleRole.js';

const chartMargin = { top: 12, right: 18, left: 0, bottom: 8 };

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '-';
  if (!Number.isFinite(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function isAbortError(err) {
  return err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
}

function normalizeTripsResponse(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeEmissionsResponse(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return rows.map((row) => ({
    date: row.date || row.day || row.timestamp || row.created_at || row.createdAt,
    co2Kg: Number(row.total_co2_kg ?? row.co2_kg ?? row.co2Kg ?? 0),
    coKg: Number(row.total_co_kg ?? row.co_kg ?? row.coKg ?? 0),
    distanceKm: Number(row.distance_km ?? row.distanceKm ?? row.trip_distance_km ?? 0),
  }));
}

function normalizeWasteEventsResponse(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

export default function TruckDetailDrawer({ open, truck, onClose }) {
  const { t } = useTranslation();
  const truckId = truck?.id;
  const [activeTab, setActiveTab] = useState('overview');
  const [detail, setDetail] = useState(truck || null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [telemetryLatest, setTelemetryLatest] = useState(null);
  const [telemetryFallback, setTelemetryFallback] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState('');
  const [rentalState, setRentalState] = useState({ data: null, loading: false, error: '' });
  const [tripsState, setTripsState] = useState({ data: [], loading: false, error: '', loadedFor: null });
  const [emissionsState, setEmissionsState] = useState({ data: [], loading: false, error: '', loadedFor: null });
  const [wasteState, setWasteState] = useState({ data: [], loading: false, error: '', loadedFor: null });

  useEffect(() => {
    if (!open) return;
    setDetail(truck || null);
    setActiveTab('overview');
    setTripsState({ data: [], loading: false, error: '', loadedFor: null });
    setEmissionsState({ data: [], loading: false, error: '', loadedFor: null });
    setWasteState({ data: [], loading: false, error: '', loadedFor: null });
    setRentalState({ data: null, loading: false, error: '' });
    setTelemetryFallback(null);
  }, [open, truckId, truck]);

  useEffect(() => {
    if (!open || !truckId) return;
    const controller = new AbortController();
    let active = true;
    setDetailLoading(true);
    setDetailError('');
    fetchTruckById(truckId, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        setDetail(res.data?.data || truck || null);
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setDetailError(err?.response?.data?.message || t('Unable to load truck details.'));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, t, truck]);

  useEffect(() => {
    if (!open || !truckId) return;
    const controller = new AbortController();
    let active = true;
    setTelemetryLoading(true);
    setTelemetryError('');
    fetchTruckTelemetryLatest(truckId, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        setTelemetryLatest(normalizeTelemetryLatest(res.data));
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setTelemetryError(err?.response?.data?.message || t('Telemetry not available.'));
        setTelemetryLatest(null);
      })
      .finally(() => {
        if (active) setTelemetryLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, t]);

  useEffect(() => {
    if (!open || !truckId || telemetryLoading) return;
    if (resolveTelemetryCoords(telemetryLatest)) {
      if (telemetryFallback) setTelemetryFallback(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    fetchTruckTelemetryWindow(truckId, 1440, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        const rows = normalizeTelemetryWindow(res.data);
        const lastWithCoords = [...rows].reverse().find((row) => resolveTelemetryCoords(row));
        setTelemetryFallback(lastWithCoords || null);
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setTelemetryFallback(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, telemetryLoading, telemetryLatest]);

  const detailTruck = detail || truck;
  const roleKey = resolveVehicleRoleFromTruck(detailTruck);
  const isWasteTruck = roleKey === 'waste_truck';
  const ownershipKey = normalizeOwnershipType(detailTruck?.ownership_type, {
    fallback: 'municipality_owned',
  });
  const isRented = ownershipKey === 'rented';
  const mapTelemetry = useMemo(() => {
    if (resolveTelemetryCoords(telemetryLatest)) return telemetryLatest;
    if (resolveTelemetryCoords(telemetryFallback)) return telemetryFallback;
    return telemetryLatest || telemetryFallback;
  }, [telemetryLatest, telemetryFallback]);

  useEffect(() => {
    if (!open || !truckId || !isRented) return;
    const controller = new AbortController();
    let active = true;
    setRentalState({ data: null, loading: true, error: '' });
    fetchTruckRental(truckId, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        setRentalState({ data: res.data?.data || res.data || null, loading: false, error: '' });
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setRentalState({
          data: null,
          loading: false,
          error: err?.response?.data?.message || t('Data not available.'),
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, isRented, t]);

  useEffect(() => {
    if (!open || !truckId || activeTab !== 'trips') return;
    if (tripsState.loadedFor === truckId) return;
    const controller = new AbortController();
    let active = true;
    setTripsState({ data: [], loading: true, error: '', loadedFor: truckId });
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 30);
    fetchTruckTrips(
      truckId,
      { from: from.toISOString(), to: to.toISOString() },
      { signal: controller.signal }
    )
      .then((res) => {
        if (!active) return;
        setTripsState({
          data: normalizeTripsResponse(res.data),
          loading: false,
          error: '',
          loadedFor: truckId,
        });
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setTripsState({
          data: [],
          loading: false,
          error: err?.response?.data?.message || t('Data not available.'),
          loadedFor: truckId,
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, activeTab, tripsState.loadedFor, t]);

  useEffect(() => {
    if (!open || !truckId || activeTab !== 'emissions') return;
    if (emissionsState.loadedFor === truckId) return;
    const controller = new AbortController();
    let active = true;
    setEmissionsState({ data: [], loading: true, error: '', loadedFor: truckId });
    fetchTruckEmissions(truckId, { days: 14 }, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        setEmissionsState({
          data: normalizeEmissionsResponse(res.data),
          loading: false,
          error: '',
          loadedFor: truckId,
        });
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setEmissionsState({
          data: [],
          loading: false,
          error: err?.response?.data?.message || t('Data not available.'),
          loadedFor: truckId,
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, activeTab, emissionsState.loadedFor, t]);

  useEffect(() => {
    if (!open || !truckId || activeTab !== 'waste') return;
    if (wasteState.loadedFor === truckId) return;
    const controller = new AbortController();
    let active = true;
    setWasteState({ data: [], loading: true, error: '', loadedFor: truckId });
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 30);
    fetchTruckWasteLoadEvents(
      truckId,
      { from: from.toISOString(), to: to.toISOString() },
      { signal: controller.signal }
    )
      .then((res) => {
        if (!active) return;
        setWasteState({
          data: normalizeWasteEventsResponse(res.data),
          loading: false,
          error: '',
          loadedFor: truckId,
        });
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setWasteState({
          data: [],
          loading: false,
          error: err?.response?.data?.message || t('Data not available.'),
          loadedFor: truckId,
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, truckId, activeTab, wasteState.loadedFor, t]);

  const emissionsTotals = useMemo(() => {
    if (!emissionsState.data.length) {
      return { co2Kg: null, coKg: null, distanceKm: null };
    }
    return emissionsState.data.reduce(
      (acc, row) => {
        acc.co2Kg += Number(row.co2Kg || 0);
        acc.coKg += Number(row.coKg || 0);
        acc.distanceKm += Number(row.distanceKm || 0);
        return acc;
      },
      { co2Kg: 0, coKg: 0, distanceKm: 0 }
    );
  }, [emissionsState.data]);

  const emissionsChartData = useMemo(() => {
    return emissionsState.data.map((row) => ({
      date: row.date ? new Date(row.date).toLocaleDateString() : t('Unknown'),
      co2Kg: Number(row.co2Kg || 0),
    }));
  }, [emissionsState.data, t]);

  const tabs = useMemo(() => {
    const baseTabs = [
      { key: 'overview', label: t('Overview') },
      { key: 'trips', label: t('Trips') },
      { key: 'emissions', label: t('Emissions') },
      { key: 'maintenance', label: t('Maintenance') },
    ];
    if (isWasteTruck) {
      baseTabs.push({ key: 'waste', label: t('Waste loading') });
    }
    return baseTabs;
  }, [isWasteTruck, t]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop">
      <div className="drawer-panel">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">
              {detailTruck?.truck_code
                ? t('Truck {{code}}', { code: detailTruck.truck_code })
                : t('Truck details')}
            </div>
            <div className="drawer-subtitle">
              {detailTruck?.plate_number || t('No plate assigned')}
            </div>
          </div>
          <div className="drawer-header-actions">
            {detailTruck && (
              <div className="chip-row">
                <span className={`status-chip status-chip--${String(detailTruck.status || 'Active').toLowerCase()}`}>
                  {t(detailTruck.status || 'Active')}
                </span>
                <span className="fuel-chip">{t(detailTruck.fuel_type || '-')}</span>
              </div>
            )}
            <button type="button" className="btn-secondary btn-small" onClick={onClose}>
              {t('Close')}
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <div className="drawer-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeTab === tab.key ? 'drawer-tab drawer-tab--active' : 'drawer-tab'}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {detailLoading && <div className="loading-state">{t('Loading truck details...')}</div>}
          {!detailLoading && detailError && <div className="inline-error">{detailError}</div>}

          {activeTab === 'overview' && (
            <div className="drawer-section">
              <div className="panel">
                <div className="details-title">{t('Truck info')}</div>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">{t('Truck code')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.truck_code)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Plate number')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.plate_number)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Model')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.model)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Capacity')}</span>
                    <span className="detail-value">
                      {Number.isFinite(Number(detailTruck?.capacity_tons))
                        ? `${detailTruck.capacity_tons} ${t('tons')}`
                        : '-'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('GPS IMEI')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.gps_imei)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Vehicle role')}</span>
                    <span className="detail-value">
                      {roleKey === 'support_car' ? t('Support car') : t('Waste truck')}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Ownership')}</span>
                    <span className="detail-value">
                      {ownershipKey === 'rented' ? t('Rented') : t('Municipality')}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Fuel type')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.fuel_type)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('CO₂ factor')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.co2_factor_per_liter)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('CO factor')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.co_factor_per_liter)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Fuel efficiency (km/L)')}</span>
                    <span className="detail-value">
                      {formatValue(detailTruck?.fuel_efficiency_km_per_liter)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Energy efficiency (kWh/km)')}</span>
                    <span className="detail-value">
                      {formatValue(detailTruck?.fuel_efficiency_kwh_per_km)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Municipality')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.municipality_id)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Home center')}</span>
                    <span className="detail-value">{formatValue(detailTruck?.home_center_id)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Created')}</span>
                    <span className="detail-value">{formatDateTime(detailTruck?.created_at)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Updated')}</span>
                    <span className="detail-value">{formatDateTime(detailTruck?.updated_at)}</span>
                  </div>
                </div>
              </div>

              {isRented && (
                <div className="panel">
                  <div className="details-title">{t('Rental')}</div>
                  {rentalState.loading && <div className="loading-state">{t('Loading rental info...')}</div>}
                  {!rentalState.loading && rentalState.error && (
                    <div className="empty-state">{rentalState.error}</div>
                  )}
                  {!rentalState.loading && !rentalState.error && (
                    <div className="details-grid">
                      <div className="detail-item">
                        <span className="detail-label">{t('Vendor')}</span>
                        <span className="detail-value">
                          {formatValue(rentalState.data?.vendor_name || rentalState.data?.vendor)}
                        </span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">{t('Start date')}</span>
                        <span className="detail-value">{formatDateTime(rentalState.data?.start_date)}</span>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">{t('End date')}</span>
                        <span className="detail-value">{formatDateTime(rentalState.data?.end_date)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <TruckMap
                truck={detailTruck}
                telemetry={mapTelemetry}
                height={240}
                title={t('Last GPS location')}
              />
              {telemetryLoading && <div className="loading-state">{t('Loading telemetry...')}</div>}
              {!telemetryLoading && telemetryError && <div className="empty-state">{telemetryError}</div>}
            </div>
          )}

          {activeTab === 'trips' && (
            <div className="panel">
              <div className="details-title">{t('Trips')}</div>
              {tripsState.loading && <div className="loading-state">{t('Loading trips...')}</div>}
              {!tripsState.loading && tripsState.error && (
                <div className="empty-state">{tripsState.error}</div>
              )}
              {!tripsState.loading && !tripsState.error && tripsState.data.length === 0 && (
                <div className="empty-state">{t('No trips found')}</div>
              )}
              {!tripsState.loading && tripsState.data.length > 0 && (
                <div className="truck-table-wrapper">
                  <table className="truck-table">
                    <thead>
                      <tr>
                        <th>{t('Trip')}</th>
                        <th>{t('Planned km')}</th>
                        <th>{t('Actual km')}</th>
                        <th>{t('Saved km')}</th>
                        <th>{t('Started')}</th>
                        <th>{t('Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripsState.data.map((trip, idx) => {
                        const planned = Number(trip.planned_distance_km ?? trip.plannedDistanceKm ?? 0);
                        const actual = Number(
                          trip.actual_distance_km ?? trip.actualDistanceKm ?? trip.distance_km ?? trip.distanceKm ?? 0
                        );
                        const saved =
                          Number(trip.distance_saved_km ?? trip.distanceSavedKm ?? 0) ||
                          (planned && actual ? planned - actual : 0);
                        return (
                          <tr key={trip.id || trip.trip_code || trip.tripCode || idx}>
                            <td>{trip.trip_code || trip.tripCode || trip.id}</td>
                            <td>{formatNumber(planned, 2)}</td>
                            <td>{formatNumber(actual, 2)}</td>
                            <td>{formatNumber(saved, 2)}</td>
                            <td>{formatDateTime(trip.started_at || trip.start_time)}</td>
                            <td>{formatValue(trip.status || trip.state)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'emissions' && (
            <div className="drawer-section">
              <div className="panel">
                <div className="details-title">{t('Daily CO2 (last 14 days)')}</div>
                {emissionsState.loading && <div className="loading-state">{t('Loading emissions...')}</div>}
                {!emissionsState.loading && emissionsState.error && (
                  <div className="empty-state">{emissionsState.error}</div>
                )}
                {!emissionsState.loading && !emissionsState.error && emissionsChartData.length === 0 && (
                  <div className="empty-state">{t('No emissions data')}</div>
                )}
                {!emissionsState.loading && emissionsChartData.length > 0 && (
                  <div className="chart-wrapper">
                    <ResponsiveContainer width="100%" height={240} minWidth={200}>
                      <LineChart data={emissionsChartData} margin={chartMargin}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" />
                        <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} tickMargin={8} />
                        <YAxis tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                        <Tooltip
                          cursor={{ stroke: '#0ea5e9', strokeWidth: 1 }}
                          contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0' }}
                        />
                        <Line type="monotone" dataKey="co2Kg" name={t('CO2')} stroke="#f97316" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="details-title">{t('Totals')}</div>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">{t('CO₂ per km')}</span>
                    <span className="detail-value">
                      {emissionsTotals.distanceKm
                        ? formatNumber(emissionsTotals.co2Kg / emissionsTotals.distanceKm, 3)
                        : '-'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Total CO₂')}</span>
                    <span className="detail-value">{formatNumber(emissionsTotals.co2Kg, 2)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">{t('Total CO')}</span>
                    <span className="detail-value">{formatNumber(emissionsTotals.coKg, 2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="panel">
              <div className="details-title">{t('Maintenance')}</div>
              <div className="empty-state">{t('Data not available.')}</div>
            </div>
          )}

          {activeTab === 'waste' && (
            <div className="panel">
              <div className="details-title">{t('Waste loading')}</div>
              {wasteState.loading && <div className="loading-state">{t('Loading waste events...')}</div>}
              {!wasteState.loading && wasteState.error && (
                <div className="empty-state">{wasteState.error}</div>
              )}
              {!wasteState.loading && !wasteState.error && wasteState.data.length === 0 && (
                <div className="empty-state">{t('No waste events found')}</div>
              )}
              {!wasteState.loading && wasteState.data.length > 0 && (
                <div className="truck-table-wrapper">
                  <table className="truck-table">
                    <thead>
                      <tr>
                        <th>{t('Waste type')}</th>
                        <th>{t('Weight (kg)')}</th>
                        <th>{t('Loading time')}</th>
                        <th>{t('Occurred')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wasteState.data.map((event, idx) => (
                        <tr key={event.id || event.occurred_at || event.occurredAt || idx}>
                          <td>{formatValue(event.waste_type || event.wasteType)}</td>
                          <td>{formatNumber(event.weight_kg ?? event.weightKg, 2)}</td>
                          <td>{formatNumber(event.loading_minutes ?? event.loadingMinutes, 1)}</td>
                          <td>{formatDateTime(event.occurred_at || event.occurredAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
