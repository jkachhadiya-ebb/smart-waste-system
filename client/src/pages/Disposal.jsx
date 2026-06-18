import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { createDisposalEvent, fetchDisposalDashboard } from '../api/disposalApi';

const WASTE_COLORS = ['#00c2d9', '#4fc3f7', '#6aa9f7', '#7f8cf4', '#9b59d4'];
const LANDFILL_COLORS = { used: '#2fbad4', available: '#7debf0' };
const RADIAN = Math.PI / 180;
const WASTE_TYPE_KEYS = [
  { value: 'bio', label: 'Bio', rowKey: 'bio' },
  { value: 'plastic', label: 'Plastic', rowKey: 'plastic' },
  { value: 'cardboard', label: 'Cardboard', rowKey: 'cardboard' },
  { value: 'metal', label: 'Metal', rowKey: 'metal' },
  { value: 'other', label: 'Other', rowKey: 'other' },
];
const ALL_WASTE_TYPES = WASTE_TYPE_KEYS.map((type) => type.value);
const WASTE_COLOR_MAP = Object.fromEntries(
  WASTE_TYPE_KEYS.map((type, index) => [type.value, WASTE_COLORS[index % WASTE_COLORS.length]])
);
const DEFAULT_FILTERS = { fromDate: '', toDate: '', truckId: 'all', wasteTypes: [] };

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function formatOneDecimal(n) {
  // Ensures 0.1 shows as 0.1 (not 0.10)
  return Number(n).toFixed(1).replace(/\.0$/, '');
}

function parseNumeric(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).replace(/[^0-9.-]+/g, '');
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRowDate(value) {
  if (!value) return null;
  const [first, second, third] = String(value).split('-');
  if (!first || !second || !third) return null;
  if (first.length === 4) {
    const year = Number(first);
    const month = Number(second);
    const day = Number(third);
    if (!day || !month || !year) return null;
    return new Date(year, month - 1, day);
  }
  const day = Number(first);
  const month = Number(second);
  const year = Number(third);
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.rows && typeof payload.rows === 'object') {
    return Object.values(payload.rows);
  }
  return [];
}

function normalizeDashboardPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { municipality: {}, landfill: {}, pie: {}, rows: [] };
  }
  return {
    ...payload,
    municipality: normalizeObject(payload.municipality),
    landfill: normalizeObject(payload.landfill),
    pie: normalizeObject(payload.pie),
    rows: normalizeRows(payload),
  };
}

function parseInputDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDisplayDate(value) {
  const date = parseRowDate(value);
  if (!date) return value ? String(value) : '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatTons(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatM3(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.000';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatDays(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric < 10 ? numeric.toFixed(1) : Math.round(numeric).toString();
}

export default function Disposal() {
  const { t } = useTranslation();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [simulateBusy, setSimulateBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const filterButtonRef = useRef(null);
  const filterPopoverRef = useRef(null);

  const filterKey = useMemo(
    () =>
      [
        filters.fromDate,
        filters.toDate,
        filters.truckId,
        (Array.isArray(filters.wasteTypes) ? filters.wasteTypes : []).join('|'),
      ].join('|'),
    [filters.fromDate, filters.toDate, filters.truckId, filters.wasteTypes]
  );

  const loadDashboard = useCallback(async () => {
    const params = {};
    if (filters.fromDate) params.from = filters.fromDate;
    if (filters.toDate) params.to = filters.toDate;

    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await fetchDisposalDashboard(params);
      setDashboardData(normalizeDashboardPayload(response.data));
    } catch (err) {
      console.error('Failed to load disposal dashboard', err);
      setDashboardError(t('Unable to load disposal data.'));
    } finally {
      setDashboardLoading(false);
    }
  }, [filters.fromDate, filters.toDate, t]);

  useEffect(() => {
    loadDashboard();
  }, [filterKey, refreshKey, loadDashboard]);

  const rawRows = useMemo(() => {
    const rows = Array.isArray(dashboardData?.rows) ? dashboardData.rows : [];
    return rows
      .filter((row) => row && typeof row === 'object')
      .map((row, index) => ({
        id: row.truck_id ?? row.truckId ?? row.id ?? `row-${index}`,
        date: row.date,
        total: parseNumeric(row.total_waste_t ?? row.totalWasteT),
        bio: parseNumeric(row.bio_t ?? row.bioT),
        plastic: parseNumeric(row.plastic_t ?? row.plasticT),
        cardboard: parseNumeric(row.cardboard_t ?? row.cardboardT),
        metal: parseNumeric(row.metal_t ?? row.metalT),
        other: parseNumeric(row.other_t ?? row.otherT),
        landfill: parseNumeric(row.landfill_used_m3 ?? row.landfillUsedM3),
        landfillTotal: parseNumeric(
          row.landfill_total_used_m3 ?? row.landfillTotalUsedM3
        ),
      }));
  }, [dashboardData]);

  const truckOptions = useMemo(() => {
    const seen = new Set();
    rawRows.forEach((row) => {
      if (row.id) seen.add(String(row.id));
    });
    return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rawRows]);

  const tableRows = useMemo(() => {
    const truckFilter = String(filters.truckId || '').trim();
    const fromDate = parseInputDate(filters.fromDate);
    const toDate = parseInputDate(filters.toDate);

    return rawRows.filter((row) => {
      if (truckFilter && truckFilter !== 'all' && String(row.id) !== truckFilter) {
        return false;
      }

      if (fromDate || toDate) {
        const rowDate = parseRowDate(row.date);
        if (!rowDate) return false;
        if (fromDate && rowDate < fromDate) return false;
        if (toDate && rowDate > toDate) return false;
      }

      return true;
    });
  }, [filters.truckId, filters.fromDate, filters.toDate, rawRows]);

  const selectedWasteTypes = Array.isArray(filters.wasteTypes) ? filters.wasteTypes : [];
  const activeWasteTypes = selectedWasteTypes.length ? selectedWasteTypes : ALL_WASTE_TYPES;
  const isAllWasteTypes = selectedWasteTypes.length === 0;
  const pieTotals = useMemo(() => {
    const pie = dashboardData?.pie || {};
    return {
      bio: parseNumeric(pie.bio_t),
      plastic: parseNumeric(pie.plastic_t),
      cardboard: parseNumeric(pie.cardboard_t),
      metal: parseNumeric(pie.metal_t),
      other: parseNumeric(pie.other_t),
    };
  }, [dashboardData]);

  const wasteBreakdown = useMemo(
    () =>
      WASTE_TYPE_KEYS.filter((type) => activeWasteTypes.includes(type.value)).map((type) => ({
        key: type.value,
        name: t(type.label),
        value: pieTotals[type.value] || 0,
        color: WASTE_COLOR_MAP[type.value],
      })),
    [t, activeWasteTypes, pieTotals]
  );

  const totalWaste = useMemo(
    () => wasteBreakdown.reduce((sum, item) => sum + item.value, 0),
    [wasteBreakdown]
  );

  // ---- Gauge values (landfill card) ----
  const municipalityName = dashboardData?.municipality?.name || t('Municipality');
  const landfillUsed = parseNumeric(dashboardData?.landfill?.used_m3);
  const landfillCapacity = parseNumeric(dashboardData?.landfill?.capacity_m3);
  const landfillDaysRaw = dashboardData?.landfill?.days_to_fill;
  const landfillDays = landfillDaysRaw !== null && landfillDaysRaw !== undefined
    ? formatDays(landfillDaysRaw)
    : null;
  const landfillPercent =
    landfillCapacity > 0 ? (landfillUsed / landfillCapacity) * 100 : 0;

  // Gauge geometry tuned to match the screenshot
  const gauge = useMemo(() => {
    const percent = clamp(landfillPercent, 0, 100);
    const cx = 110;
    const cy = 110;
    const r = 90;
    const circumference = 2 * Math.PI * r;
    const dashOffset = circumference - (percent / 100) * circumference;
    return { cx, cy, r, percent, circumference, dashOffset };
  }, [landfillPercent]);

  const renderDonutLabel = ({ cx, cy, midAngle, outerRadius, percent, payload }) => {
    const radius = outerRadius + 22;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    const label = payload?.name ?? '';
    const value = Number(payload?.value ?? 0);
    const pct = Math.round((percent || 0) * 100);

    return (
      <text
        x={x}
        y={y}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        className="disposal-donut-label"
      >
        <tspan x={x} dy="-0.2em">{`${label} (${pct}%)`}</tspan>
        <tspan x={x} dy="1.2em">{`${value.toFixed(2)}${t('t')}`}</tspan>
      </text>
    );
  };

  useEffect(() => {
    if (!filtersOpen) return;
    function handleOutside(event) {
      const target = event.target;
      if (filterPopoverRef.current?.contains(target)) return;
      if (filterButtonRef.current?.contains(target)) return;
      setFiltersOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setFiltersOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [filtersOpen]);

  const handleSimulateDisposal = useCallback(async () => {
    if (simulateBusy) return;
    const selectedTruck =
      filters.truckId && filters.truckId !== 'all' ? filters.truckId : rawRows[0]?.id;
    if (!selectedTruck) {
      setDashboardError(t('Select a truck to simulate a disposal.'));
      return;
    }

    setSimulateBusy(true);
    try {
      await createDisposalEvent({
        truck_id: selectedTruck,
        total_weight_kg: 20000,
      });
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to simulate disposal event', err);
      setDashboardError(t('Unable to create disposal event.'));
    } finally {
      setSimulateBusy(false);
    }
  }, [filters.truckId, rawRows, simulateBusy, t]);

  return (
    <div className="disposal-container">
      <div className="filter-row disposal-header">
        <div className="dashboard-title">{t('Disposal')}</div>

        <div className="disposal-header-actions">
          <button
            className="btn-secondary btn-small"
            type="button"
            onClick={handleSimulateDisposal}
            disabled={simulateBusy || dashboardLoading}
          >
            {simulateBusy ? t('Simulating...') : t('Simulate Disposal')}
          </button>
          <button
            className="disposal-filter-btn"
            type="button"
            aria-label={t('Filter')}
            aria-expanded={filtersOpen}
            aria-controls="disposal-filters"
            onClick={() => setFiltersOpen((prev) => !prev)}
            ref={filterButtonRef}
          >
            <span className="disposal-filter-label">{t('Filter')}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 5h18l-6.8 7.5v5.6l-4.4-2.2v-3.4L3 5z" fill="currentColor" />
            </svg>
          </button>
          <div
            className={`panel disposal-filters${filtersOpen ? ' disposal-filters--open' : ''}`}
            id="disposal-filters"
            role="dialog"
            aria-label={t('Filters')}
            aria-hidden={!filtersOpen}
            ref={filterPopoverRef}
          >
            <div className="disposal-filters-grid">
              <label className="filter-field">
                <span>{t('From')}</span>
                <input
                  type="date"
                  value={filters.fromDate}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, fromDate: event.target.value }))
                  }
                />
              </label>
              <label className="filter-field">
                <span>{t('To')}</span>
                <input
                  type="date"
                  value={filters.toDate}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, toDate: event.target.value }))
                  }
                />
              </label>
              <label className="filter-field">
                <span>{t('Truck ID')}</span>
                <select
                  value={filters.truckId}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, truckId: event.target.value }))
                  }
                >
                  <option value="all">{t('All trucks')}</option>
                  {truckOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="filter-field">
                <span>{t('Waste Type')}</span>
                <div className="disposal-checkbox-grid" role="group" aria-label={t('Waste Type')}>
                  <label className="disposal-checkbox">
                    <input
                      type="checkbox"
                      checked={isAllWasteTypes}
                      onChange={() => setFilters((prev) => ({ ...prev, wasteTypes: [] }))}
                    />
                    <span>{t('All waste types')}</span>
                  </label>
                  {WASTE_TYPE_KEYS.map((type) => (
                    <label key={type.value} className="disposal-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedWasteTypes.includes(type.value)}
                        onChange={(event) => {
                          const nextChecked = event.target.checked;
                          setFilters((prev) => {
                            const current = prev.wasteTypes;
                            if (nextChecked) {
                              return current.includes(type.value)
                                ? prev
                                : { ...prev, wasteTypes: [...current, type.value] };
                            }
                            return {
                              ...prev,
                              wasteTypes: current.filter((value) => value !== type.value),
                            };
                          });
                        }}
                      />
                      <span>{t(type.label)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="disposal-filters-actions">
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => setFilters(DEFAULT_FILTERS)}
              >
                {t('Reset')}
              </button>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => setFiltersOpen(false)}
              >
                {t('Done')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="disposal-grid">
        {/* LEFT: donut */}
        <div className="panel disposal-card">
          <div className="disposal-donut" aria-label={t('Waste breakdown')}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={wasteBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={90}
                  outerRadius={150}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2}
                  labelLine={false}
                  label={renderDonutLabel}
                >
                  {wasteBreakdown.map((entry) => (
                    <Cell key={`cell-${entry.key || entry.name}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="disposal-donut-center">
              <div className="disposal-donut-center-label">{t('Total Waste')}</div>
              <div className="disposal-donut-center-value">
                {formatTons(totalWaste)} <span>{t('t')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Koblenz gauge card */}
        <div className="panel disposal-card disposal-gauge-card">
          <div className="disposal-gauge-title">{municipalityName}</div>

          <div className="disposal-gauge">
            <div className="disposal-gauge-chart" aria-label={t('Landfill capacity')}>
              <svg className="disposal-gauge-svg" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
                <circle
                  cx={gauge.cx}
                  cy={gauge.cy}
                  r={gauge.r}
                  fill="none"
                  stroke={LANDFILL_COLORS.available}
                  strokeWidth="30"
                />
                <circle
                  cx={gauge.cx}
                  cy={gauge.cy}
                  r={gauge.r}
                  fill="none"
                  stroke={LANDFILL_COLORS.used}
                  strokeWidth="30"
                  strokeLinecap="round"
                  strokeDasharray={gauge.circumference}
                  strokeDashoffset={gauge.dashOffset}
                  transform={`rotate(-90 ${gauge.cx} ${gauge.cy})`}
                />
              </svg>

              <div className="disposal-gauge-readout">
                <div className="disposal-gauge-value">{formatOneDecimal(gauge.percent)}%</div>
                <div className="disposal-gauge-subtitle">{t('Landfill Area')}</div>
              </div>
            </div>

            <div className="disposal-gauge-meta">
              <span className="disposal-gauge-meta-strong">{t('Remaining:')}</span>{' '}
              <span>
                {formatM3(landfillUsed)} {t('of')}{' '}
                {formatM3(landfillCapacity)} m<sup>3</sup> {t('used')}
              </span>
            </div>
            <div className="disposal-gauge-meta">
              <span className="disposal-gauge-meta-strong">{t('Capacity:')}</span>{' '}
              <span>
                {formatM3(landfillCapacity)} m<sup>3</sup>
              </span>
            </div>

            <div className="disposal-gauge-days">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M12 7v5l3 2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span>
                {landfillDays ?? t('N/A')} {t('Days to Fill Up')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="panel disposal-table-panel">
        <div className="disposal-table-wrapper">
          <table className="disposal-table">
            <thead>
              <tr>
                <th>{t('Truck ID')}</th>
                <th>{t('Date')}</th>
                <th>{t('Total Waste (t)')}</th>
                <th>{t('Bio (30% t)')}</th>
                <th>{t('Plastic (t)')}</th>
                <th>{t('Cardboard (t)')}</th>
                <th>{t('Metal (t)')}</th>
                <th>{t('Other (t)')}</th>
                <th>{t('Landfill Used (m³)')}</th>
                <th>{t('Landfill Total Used (m³)')}</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length ? (
                tableRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{formatDisplayDate(row.date)}</td>
                    <td>{`${formatTons(row.total)}${t('t')}`}</td>
                    <td>{`${formatTons(row.bio)}${t('t')}`}</td>
                    <td>{`${formatTons(row.plastic)}${t('t')}`}</td>
                    <td>{`${formatTons(row.cardboard)}${t('t')}`}</td>
                    <td>{`${formatTons(row.metal)}${t('t')}`}</td>
                    <td>{`${formatTons(row.other)}${t('t')}`}</td>
                    <td>{formatM3(row.landfill)}</td>
                    <td>{formatM3(row.landfillTotal)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="10">
                    <div className="table-empty">
                      {dashboardLoading
                        ? t('Loading disposal data...')
                        : dashboardError || t('No disposal records found.')}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
