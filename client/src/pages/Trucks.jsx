import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import ExportDialog from '../components/ExportDialog.jsx';
import TruckTable from '../components/trucks/TruckTable.jsx';
import TruckFormModal from '../components/trucks/TruckFormModal.jsx';
import DeleteTruckDialog from '../components/trucks/DeleteTruckDialog.jsx';
import TruckDetailDrawer from '../components/trucks/TruckDetailDrawer.jsx';
import TruckFilters from '../components/trucks/TruckFilters.jsx';
import SummaryCards from '../components/trucks/SummaryCards.jsx';
import {
  fetchTrucks,
  createTruck,
  updateTruck,
  deleteTruck,
  fetchTruckTelemetryLatest,
  fetchTruckTelemetryWindow,
  fetchMunicipalities,
  fetchFleetEmissionsSummary,
} from '../api/trucks.js';
import {
  normalizeTelemetryLatest,
  normalizeTelemetryWindow,
  resolveTelemetryTimestamp,
  resolveTelemetryCoords,
} from '../utils/telemetry.js';
import { normalizeOwnershipType } from '../utils/ownership.js';
import { normalizeVehicleRole, resolveVehicleRoleFromTruck } from '../utils/vehicleRole.js';

const DEFAULT_FACTORS = {
  diesel: { co2: 2.68, co: 0.004 },
  petrol: { co2: 2.31, co: 0.006 },
  // CNG factor assumes liters-equivalent for kg-based factor.
  cng: { co2: 2.75, co: 0.004 },
  electric: { co2: 0, co: 0 },
  hybrid: { co2: 2.31, co: 0.006 },
};

const ASSUMED_KM_PER_LITER = {
  waste_truck: 2.5,
  support_car: 12,
};

const DEFAULT_FILTERS = {
  search: '',
  status: '',
  fuel_type: '',
  vehicle_role: '',
  ownership_type: '',
  fromDate: '',
  toDate: '',
};

const DEFAULT_SORT = { field: 'truck_code', order: 'asc' };

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function resolveFuelType(truck, row) {
  const candidate =
    row?.fuel_type || row?.fuelType || truck?.fuel_type || truck?.fuelType || 'diesel';
  return String(candidate).toLowerCase();
}

function resolveFactors(truck, fuelType) {
  if (fuelType === 'electric') return { co2: 0, co: 0 };
  const defaults = DEFAULT_FACTORS[fuelType] || DEFAULT_FACTORS.diesel;
  const co2 = toNumber(truck?.co2_factor_per_liter);
  const co = toNumber(truck?.co_factor_per_liter);
  return {
    co2: Number.isFinite(co2) ? co2 : defaults.co2,
    co: Number.isFinite(co) ? co : defaults.co,
  };
}

function resolveDistanceKm(row, prevRow) {
  const direct = toNumber(row?.distance_km ?? row?.distanceKm);
  if (Number.isFinite(direct)) return direct;
  const odo = toNumber(row?.odometer_km ?? row?.odometerKm);
  const prevOdo = toNumber(prevRow?.odometer_km ?? prevRow?.odometerKm);
  if (Number.isFinite(odo) && Number.isFinite(prevOdo) && odo >= prevOdo) {
    return odo - prevOdo;
  }
  const coords = resolveTelemetryCoords(row);
  const prevCoords = resolveTelemetryCoords(prevRow);
  if (coords && prevCoords) {
    return haversineKm(prevCoords.lat, prevCoords.lng, coords.lat, coords.lng);
  }
  return 0;
}

function resolveFuelLiters(row, truck, prevRow) {
  const direct = toNumber(
    row?.fuel_used_liters ?? row?.fuel_liters ?? row?.fuelLiters ?? row?.fuel_used
  );
  if (Number.isFinite(direct)) return direct;
  const distanceKm = resolveDistanceKm(row, prevRow);
  const role = resolveVehicleRoleFromTruck(truck);
  const kmPerLiter =
    toNumber(truck?.fuel_efficiency_km_per_liter) ||
    ASSUMED_KM_PER_LITER[role] ||
    ASSUMED_KM_PER_LITER.waste_truck;
  return distanceKm > 0 ? distanceKm / kmPerLiter : 0;
}

function resolveEnergyKwh(row, truck, prevRow) {
  const direct = toNumber(
    row?.energy_kwh ?? row?.energy_used_kwh ?? row?.energyUsedKwh ?? row?.kwh
  );
  if (Number.isFinite(direct)) return direct;
  const distanceKm = resolveDistanceKm(row, prevRow);
  const kwhPerKm = toNumber(truck?.fuel_efficiency_kwh_per_km);
  if (Number.isFinite(kwhPerKm) && distanceKm > 0) {
    return distanceKm * kwhPerKm;
  }
  return null;
}

function computeEmissions(row, truck, prevRow) {
  const fuelType = resolveFuelType(truck, row);
  if (fuelType === 'electric') {
    return {
      fuelLiters: null,
      energyKwh: resolveEnergyKwh(row, truck, prevRow),
      co2Kg: 0,
      coKg: 0,
    };
  }
  const fuelLiters = resolveFuelLiters(row, truck, prevRow);
  const factors = resolveFactors(truck, fuelType);
  return {
    fuelLiters,
    energyKwh: null,
    co2Kg: fuelLiters * factors.co2,
    coKg: fuelLiters * factors.co,
  };
}

function normalizeTrucksResponse(payload) {
  if (Array.isArray(payload)) {
    return {
      rows: payload,
      pagination: { page: 1, limit: payload.length || 1, total: payload.length, totalPages: 1 },
      client: true,
    };
  }
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.rows)
      ? payload.rows
      : [];
  const pagination = payload?.pagination || {
    page: 1,
    limit: rows.length || 1,
    total: rows.length,
    totalPages: 1,
  };
  return {
    rows,
    pagination,
    client: false,
  };
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function isAbortError(err) {
  return err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED';
}

function applyClientFilters(rows, filters) {
  const search = String(filters.search || '').trim().toLowerCase();
  const statusFilter = String(filters.status || '').trim().toLowerCase();
  const fuelFilter = String(filters.fuel_type || '').trim().toLowerCase();
  const roleFilter = normalizeVehicleRole(filters.vehicle_role, { fallback: '' });
  const ownershipFilter = normalizeOwnershipType(filters.ownership_type, { fallback: '' });

  let fromDate = null;
  let toDate = null;
  if (filters.fromDate) {
    fromDate = new Date(filters.fromDate);
    fromDate.setHours(0, 0, 0, 0);
  }
  if (filters.toDate) {
    toDate = new Date(filters.toDate);
    toDate.setHours(23, 59, 59, 999);
  }

  return rows.filter((truck) => {
    if (search) {
      const haystack = `${truck.truck_code || ''} ${truck.plate_number || ''} ${truck.model || ''} ${truck.gps_imei || ''}`
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (statusFilter) {
      const status = String(truck.status || 'Active').toLowerCase();
      if (statusFilter === 'active') {
        if (status && status !== 'active') return false;
      } else if (status !== statusFilter) {
        return false;
      }
    }

    if (fuelFilter && String(truck.fuel_type || '').toLowerCase() !== fuelFilter) {
      return false;
    }

    if (roleFilter && resolveVehicleRoleFromTruck(truck) !== roleFilter) {
      return false;
    }

    if (ownershipFilter) {
      const ownership = normalizeOwnershipType(truck.ownership_type, {
        fallback: 'municipality_owned',
      });
      if (ownership !== ownershipFilter) return false;
    }

    if (fromDate || toDate) {
      const created = truck.created_at ? new Date(truck.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return false;
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
    }

    return true;
  });
}

function computeTodayMetrics(history, truck) {
  const fuelType = resolveFuelType(truck, null);
  const fuelUnit = fuelType === 'electric' ? 'kWh' : 'L';

  if (!Array.isArray(history) || history.length === 0) {
    return { todayDistanceKm: null, todayFuel: null, todayCo2Kg: null, fuelUnit };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = history.filter((row) => {
    const ts = row.timestamp || row.created_at || row.time;
    if (!ts) return false;
    const date = new Date(ts);
    return Number.isFinite(date.getTime()) && date >= todayStart;
  });

  if (!rows.length) {
    return { todayDistanceKm: null, todayFuel: null, todayCo2Kg: null, fuelUnit };
  }

  let totalDistance = 0;
  let totalFuel = 0;
  let totalEnergy = 0;
  let totalCo2 = 0;
  let hasFuel = false;
  let hasEnergy = false;

  rows.forEach((row, idx) => {
    const prevRow = idx > 0 ? rows[idx - 1] : null;
    totalDistance += resolveDistanceKm(row, prevRow);
    const emissions = computeEmissions(row, truck, prevRow);
    if (Number.isFinite(emissions.fuelLiters)) {
      totalFuel += emissions.fuelLiters;
      hasFuel = true;
    }
    if (Number.isFinite(emissions.energyKwh)) {
      totalEnergy += emissions.energyKwh;
      hasEnergy = true;
    }
    totalCo2 += Number(emissions.co2Kg || 0);
  });

  const isElectric = fuelType === 'electric';
  return {
    todayDistanceKm: totalDistance,
    todayFuel: isElectric ? (hasEnergy ? totalEnergy : null) : hasFuel ? totalFuel : null,
    todayCo2Kg: totalCo2,
    fuelUnit,
  };
}

function resolveGpsMeta(latest, history = []) {
  let row = normalizeTelemetryLatest(latest);
  let tsValue = resolveTelemetryTimestamp(row);
  if (!tsValue && Array.isArray(history) && history.length) {
    row = history[history.length - 1];
    tsValue = resolveTelemetryTimestamp(row);
  }
  if (!tsValue) return { gpsStatus: 'unknown', lastSeen: '-' };
  const ts = new Date(tsValue);
  if (!Number.isFinite(ts.getTime())) return { gpsStatus: 'unknown', lastSeen: '-' };
  const minutes = (Date.now() - ts.getTime()) / 60000;
  return {
    gpsStatus: minutes <= 15 ? 'online' : 'offline',
    lastSeen: ts.toLocaleString(),
  };
}

export default function Trucks() {
  const { t } = useTranslation();
  const [rawTrucks, setRawTrucks] = useState([]);
  const [clientMode, setClientMode] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');
  const [rowMetrics, setRowMetrics] = useState({});
  const [weeklyCo2Kg, setWeeklyCo2Kg] = useState(null);
  const [weeklyCo2Loading, setWeeklyCo2Loading] = useState(false);
  const [municipalities, setMunicipalities] = useState([]);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTruck, setEditingTruck] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pagedRowsRef = useRef([]);
  const rowMetricsRef = useRef({});

  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput }));
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function loadMunicipalities() {
      try {
        const res = await fetchMunicipalities({ signal: controller.signal });
        if (!active) return;
        if (Array.isArray(res.data?.data)) {
          setMunicipalities(res.data.data);
        } else if (Array.isArray(res.data)) {
          setMunicipalities(res.data);
        }
      } catch (err) {
        if (!active || isAbortError(err)) return;
        setMunicipalities([]);
      }
    }
    loadMunicipalities();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadingList(true);
    setListError('');

    const params = {
      search: filters.search || undefined,
      status: filters.status || undefined,
      fuel_type: filters.fuel_type || undefined,
      vehicle_role: normalizeVehicleRole(filters.vehicle_role, { fallback: '' }) || undefined,
      ownership_type: normalizeOwnershipType(filters.ownership_type, { fallback: '' }) || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
      page,
      limit,
      sort: sortConfig.field,
      order: sortConfig.order,
    };

    fetchTrucks(params, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        const normalized = normalizeTrucksResponse(res.data);
        setRawTrucks(normalized.rows);
        setClientMode(normalized.client);
        const nextPagination = {
          page: normalized.pagination?.page || page,
          limit: normalized.pagination?.limit || limit,
          total: normalized.pagination?.total || normalized.rows.length,
          totalPages: normalized.pagination?.totalPages || 1,
        };
        setPagination(nextPagination);
        if (!normalized.client && nextPagination.page !== page) {
          setPage(nextPagination.page);
        }
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        const msg = err?.response?.data?.message || t('Unable to load trucks.');
        setListError(msg);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, page, limit, sortConfig.field, sortConfig.order, reloadKey, t]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setWeeklyCo2Loading(true);
    fetchFleetEmissionsSummary({ days: 7 }, { signal: controller.signal })
      .then((res) => {
        if (!active) return;
        const value =
          res.data?.total_co2_kg ??
          res.data?.totalCo2Kg ??
          res.data?.data?.total_co2_kg ??
          res.data?.data?.totalCo2Kg;
        setWeeklyCo2Kg(Number.isFinite(Number(value)) ? Number(value) : null);
      })
      .catch((err) => {
        if (!active || isAbortError(err)) return;
        setWeeklyCo2Kg(null);
      })
      .finally(() => {
        if (active) setWeeklyCo2Loading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const filteredRows = useMemo(() => {
    if (!clientMode) return rawTrucks;
    return applyClientFilters(rawTrucks, filters);
  }, [clientMode, rawTrucks, filters]);

  const metricsForSort = sortConfig.field === 'today_co2' ? rowMetrics : null;

  const sortedRows = useMemo(() => {
    if (!sortConfig.field) return filteredRows;
    const direction = sortConfig.order === 'desc' ? -1 : 1;
    const rows = [...filteredRows];

    rows.sort((a, b) => {
      const field = sortConfig.field;
      if (field === 'today_co2') {
        const aVal = Number(metricsForSort?.[a.id]?.todayCo2Kg);
        const bVal = Number(metricsForSort?.[b.id]?.todayCo2Kg);
        const safeA = Number.isFinite(aVal) ? aVal : -Infinity;
        const safeB = Number.isFinite(bVal) ? bVal : -Infinity;
        return (safeA - safeB) * direction;
      }

      const aText = String(a[field] || '').toLowerCase();
      const bText = String(b[field] || '').toLowerCase();
      if (aText === bText) return 0;
      return aText.localeCompare(bText) * direction;
    });

    return rows;
  }, [filteredRows, sortConfig.field, sortConfig.order, metricsForSort]);

  const displayPagination = useMemo(() => {
    if (!clientMode) return pagination;
    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    return { page: currentPage, limit, total, totalPages };
  }, [clientMode, filteredRows.length, page, limit, pagination]);

  const pagedRows = useMemo(() => {
    if (!clientMode) return sortedRows;
    const start = (displayPagination.page - 1) * limit;
    return sortedRows.slice(start, start + limit);
  }, [clientMode, sortedRows, displayPagination.page, limit]);

  useEffect(() => {
    if (clientMode && page !== displayPagination.page) {
      setPage(displayPagination.page);
    }
  }, [clientMode, page, displayPagination.page]);

  useEffect(() => {
    pagedRowsRef.current = pagedRows;
  }, [pagedRows]);

  useEffect(() => {
    rowMetricsRef.current = rowMetrics;
  }, [rowMetrics]);

  const visibleIdsKey = useMemo(() => {
    const ids = pagedRows
      .map((truck) => truck.id)
      .filter(Boolean)
      .map(String)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return ids.join('|');
  }, [pagedRows]);

  useEffect(() => {
    const visibleRows = pagedRowsRef.current;
    if (!visibleRows.length) {
      if (Object.keys(rowMetricsRef.current).length > 0) {
        setRowMetrics({});
      }
      return;
    }

    const pending = visibleRows.filter((truck) => {
      const existing = rowMetricsRef.current[truck.id];
      return !existing || existing.loading;
    });
    if (!pending.length) return;

    const controller = new AbortController();
    let active = true;

    setRowMetrics((prev) => {
      const next = { ...prev };
      pending.forEach((truck) => {
        next[truck.id] = { ...(prev[truck.id] || {}), loading: true };
      });
      return next;
    });

    async function loadMetrics() {
      const updates = {};
      await Promise.all(
        pending.map(async (truck) => {
          let latest = null;
          let history = [];

          try {
            const latestRes = await fetchTruckTelemetryLatest(truck.id, {
              signal: controller.signal,
            });
            latest = normalizeTelemetryLatest(latestRes.data);
          } catch (err) {
            if (isAbortError(err)) return;
          }

          try {
            const historyRes = await fetchTruckTelemetryWindow(truck.id, 1440, {
              signal: controller.signal,
            });
            history = normalizeTelemetryWindow(historyRes.data);
          } catch (err) {
            if (isAbortError(err)) return;
          }

          const gps = resolveGpsMeta(latest, history);
          const today = computeTodayMetrics(history, truck);

          updates[truck.id] = {
            ...gps,
            ...today,
            loading: false,
          };
        })
      );

      if (!active) return;
      if (Object.keys(updates).length > 0) {
        setRowMetrics((prev) => ({ ...prev, ...updates }));
      }
    }

    loadMetrics();

    return () => {
      active = false;
      controller.abort();
    };
  }, [visibleIdsKey]);

  const summaryCounts = useMemo(() => {
    const source = clientMode ? filteredRows : rawTrucks;
    const activeCount = source.filter((truck) => {
      const status = String(truck.status || 'Active').toLowerCase();
      return status === 'active' || status === '';
    }).length;
    const wasteCount = source.filter(
      (truck) => resolveVehicleRoleFromTruck(truck) === 'waste_truck'
    ).length;
    const supportCount = source.filter(
      (truck) => resolveVehicleRoleFromTruck(truck) === 'support_car'
    ).length;
    return { activeCount, wasteCount, supportCount };
  }, [clientMode, filteredRows, rawTrucks]);

  useEffect(() => {
    if (!selectedTruck) return;
    const updated = rawTrucks.find((truck) => String(truck.id) === String(selectedTruck.id));
    if (updated) setSelectedTruck(updated);
  }, [rawTrucks, selectedTruck]);

  function updateFilter(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPage(1);
  }

  function handleResetFilters() {
    setSearchInput('');
    setFilters(DEFAULT_FILTERS);
    setSortConfig(DEFAULT_SORT);
    setPage(1);
  }

  function handleSortChange(field) {
    setSortConfig((prev) => {
      if (prev.field === field) {
        return { field, order: prev.order === 'asc' ? 'desc' : 'asc' };
      }
      return { field, order: 'asc' };
    });
  }

  function handleViewTruck(truck) {
    setSelectedTruck(truck);
    setDrawerOpen(true);
  }

  async function handleSaveTruck(payload) {
    setSaving(true);
    try {
      if (editingTruck) {
        await updateTruck(editingTruck.id, payload);
        toast.success(t('Truck updated'));
      } else {
        await createTruck(payload);
        toast.success(t('Truck created'));
      }
      setShowForm(false);
      setEditingTruck(null);
      setPage(1);
      setReloadKey((prev) => prev + 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || t('Truck save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTruck() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTruck(deleteTarget.id);
      toast.success(t('Truck deleted'));
      if (selectedTruck && String(selectedTruck.id) === String(deleteTarget.id)) {
        setDrawerOpen(false);
        setSelectedTruck(null);
      }
      setDeleteTarget(null);
      setPage(1);
      setReloadKey((prev) => prev + 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || t('Delete failed'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleExportTrucks({ format } = {}) {
    if (format && format !== 'csv') {
      throw new Error(t('Only CSV export is available for trucks.'));
    }

    const exportRows = clientMode ? filteredRows : pagedRows;
    if (!exportRows.length) {
      throw new Error(t('No trucks available to export.'));
    }

    const headers = [
      'truck_code',
      'plate_number',
      'model',
      'capacity_tons',
      'gps_imei',
      'status',
      'fuel_type',
      'vehicle_role',
      'ownership_type',
      'municipality_id',
      'home_center_id',
      'fuel_efficiency_km_per_liter',
      'fuel_efficiency_kwh_per_km',
      'co2_factor_per_liter',
      'co_factor_per_liter',
      'created_at',
      'updated_at',
    ];

    const rows = exportRows.map((truck) => headers.map((key) => escapeCsv(truck[key])));
    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'trucks.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="trucks-container">
      <div className="filter-row">
        <div>
          <div className="dashboard-title">{t('Trucks')}</div>
          <div className="trucks-subtitle">
            {t('Fleet overview, rentals, GPS status, fuel and emissions')}
          </div>
        </div>
        <div className="trucks-header-actions">
          <button type="button" className="btn-secondary" onClick={() => setExportOpen(true)}>
            {t('Export')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditingTruck(null);
              setShowForm(true);
            }}
          >
            {t('Add Truck')}
          </button>
        </div>
      </div>

      {listError && <div className="offline-banner offline-banner--warn">{listError}</div>}

      <SummaryCards
        activeCount={summaryCounts.activeCount}
        wasteCount={summaryCounts.wasteCount}
        supportCount={summaryCounts.supportCount}
        co2WeekKg={weeklyCo2Kg}
        loadingCo2={weeklyCo2Loading}
      />

      <TruckFilters
        filters={filters}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        onFilterChange={updateFilter}
        onReset={handleResetFilters}
      />

      <div className="panel">
        <TruckTable
          trucks={pagedRows}
          loading={loadingList}
          page={displayPagination.page}
          totalPages={displayPagination.totalPages}
          totalCount={displayPagination.total}
          onPageChange={setPage}
          onViewTruck={handleViewTruck}
          onEditTruck={(truck) => {
            setEditingTruck(truck);
            setShowForm(true);
          }}
          onDeleteTruck={setDeleteTarget}
          sortField={sortConfig.field}
          sortOrder={sortConfig.order}
          onSortChange={handleSortChange}
          metricsById={rowMetrics}
        />
      </div>

      <TruckDetailDrawer
        open={drawerOpen}
        truck={selectedTruck}
        onClose={() => setDrawerOpen(false)}
      />

      <TruckFormModal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingTruck(null);
        }}
        onSubmit={handleSaveTruck}
        initialData={editingTruck}
        saving={saving}
        municipalities={municipalities}
      />

      <DeleteTruckDialog
        isOpen={Boolean(deleteTarget)}
        truck={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTruck}
        deleting={deleting}
      />

      {exportOpen && (
        <ExportDialog
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          companyName={t('Smart Waste System')}
          mode="trucks"
          defaultFormat="csv"
          onExport={handleExportTrucks}
        />
      )}
    </div>
  );
}
