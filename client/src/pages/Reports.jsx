import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { fetchReportMunicipalities, fetchReportsEmissions } from '../api/reports.js';

const WARMING_COLORS = [
  '#00c2d9',
  '#4fc3f7',
  '#6aa9f7',
  '#7e82e8',
  '#9b59d4',
  '#b5179e',
  '#d0005f',
  '#e14c43',
  '#f7984f',
  '#ffd07a',
  '#e6ea75',
  '#96dc6a',
];

const LIVE_REFRESH_MS = 3000;
const COMPARE_NONE = 'none';
const LIVE_LINE_COLOR = '#5fd3d9';
const COMPARE_LINE_COLOR = '#f97316';
const COMPARE_TWO_LINE_COLOR = '#3b82f6';

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseCompareId(value) {
  if (!value || value === COMPARE_NONE) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function resolveMunicipalityLabel(municipality) {
  if (!municipality) return '';
  return (
    municipality.name ||
    municipality.municipality_code ||
    municipality.city ||
    municipality.state_region ||
    `Municipality ${municipality.id}`
  );
}

function formatBucketLabel(bucket, bucketKey) {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return '';
  switch (bucketKey) {
    case 'year':
      return date.toLocaleDateString(undefined, { year: 'numeric' });
    case 'month':
      return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    case 'day':
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    case 'hour':
      return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
    case 'minute':
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    case '30d':
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    case '24h':
      return date.toLocaleTimeString(undefined, { hour: '2-digit' });
    case 'live':
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    case '12m':
    default:
      return date.toLocaleDateString(undefined, { month: 'short' });
  }
}

function mapPoints(points, range, valueKey, scale = 1, bucketKey) {
  const key = bucketKey || range;
  return points.map((point) => ({
    label: formatBucketLabel(point.bucket, key),
    value: toNumber(point[valueKey]) * scale,
    bucket: point.bucket,
  }));
}

function lastPointValue(points, key) {
  const last = points.length ? points[points.length - 1] : null;
  return last ? toNumber(last[key]) : 0;
}

const EURO_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FOOTPRINT_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function formatEuro(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return EURO_FORMATTER.format(num);
}

function formatFootprintValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return FOOTPRINT_FORMATTER.format(num);
}

function sumPointValues(points, key) {
  return points.reduce((total, point) => total + toNumber(point[key]), 0);
}

function maxPointValue(points, key) {
  return points.reduce((max, point) => Math.max(max, Math.abs(toNumber(point[key]))), 0);
}

function formatWarmingValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  if (abs === 0) return '0';
  if (abs < 0.000001) return num.toExponential(2);
  if (abs < 0.001) return num.toExponential(2);
  return num.toFixed(6);
}

export default function Reports() {
  const { t } = useTranslation();
  const [range, setRange] = useState('live');
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [compareA, setCompareA] = useState(COMPARE_NONE);
  const [compareB, setCompareB] = useState(COMPARE_NONE);
  const [municipalities, setMunicipalities] = useState([]);
  const [reportData, setReportData] = useState({
    primary: { points: [], totals: null },
    compareA: null,
    compareB: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const compareAId = useMemo(() => parseCompareId(compareA), [compareA]);
  const compareBId = useMemo(() => parseCompareId(compareB), [compareB]);

  const municipalityOptions = useMemo(
    () =>
      municipalities.map((municipality) => ({
        id: String(municipality.id),
        label: resolveMunicipalityLabel(municipality),
      })),
    [municipalities]
  );

  const municipalityLabelMap = useMemo(() => {
    const map = new Map();
    municipalityOptions.forEach((option) => {
      map.set(option.id, option.label);
    });
    return map;
  }, [municipalityOptions]);

  const compareOneLabel = compareAId
    ? municipalityLabelMap.get(String(compareAId)) || t('Compare A')
    : '';
  const compareTwoLabel = compareBId
    ? municipalityLabelMap.get(String(compareBId)) || t('Compare B')
    : '';
  const isComparing = Boolean(compareAId || compareBId);

  useEffect(() => {
    let active = true;

    fetchReportMunicipalities()
      .then((response) => {
        if (!active) return;
        setMunicipalities(response?.data?.data || []);
      })
      .catch((err) => {
        console.error('Failed to load municipalities', err);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer;

    const loadReports = async () => {
      setError('');
      setLoading(true);
      try {
        const params = { range, live: liveEnabled };
        if (range === 'live') params.allVehicles = true;
        if (compareAId) params.compareA = compareAId;
        if (compareBId) params.compareB = compareBId;
        const response = await fetchReportsEmissions(params);
        if (!active) return;
        setReportData(response.data);
      } catch (err) {
        if (!active) return;
        console.error('Failed to load report emissions', err);
        setError(err?.response?.data?.message || t('Unable to load report data.'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadReports();

    if (liveEnabled && range === 'live') {
      timer = setInterval(loadReports, LIVE_REFRESH_MS);
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [range, compareAId, compareBId, liveEnabled, t]);

  const primaryPoints = reportData.primary?.points || [];
  const compareAPoints = reportData.compareA?.points || [];
  const compareBPoints = reportData.compareB?.points || [];

  const primaryTotals = reportData.primary?.totals || {};
  const compareATotals = reportData.compareA?.totals || {};
  const compareBTotals = reportData.compareB?.totals || {};
  const primaryBucket = reportData.primary?.bucket || range;
  const compareABucket = reportData.compareA?.bucket || range;
  const compareBBucket = reportData.compareB?.bucket || range;

  const warmingValueKey = 'warming_c';
  const warmingUnitLabel = '\u00b0C';
  const warmingThreshold = 1e-12;

  const footprintMax = useMemo(() => {
    const pointMax = Math.max(
      maxPointValue(primaryPoints, 'co2e_kg'),
      maxPointValue(compareAPoints, 'co2e_kg'),
      maxPointValue(compareBPoints, 'co2e_kg')
    );
    const totalMax = Math.max(
      Math.abs(toNumber(primaryTotals?.co2e_kg_total)),
      Math.abs(toNumber(compareATotals?.co2e_kg_total)),
      Math.abs(toNumber(compareBTotals?.co2e_kg_total))
    );
    return Math.max(pointMax, totalMax);
  }, [primaryPoints, compareAPoints, compareBPoints, primaryTotals, compareATotals, compareBTotals]);

  const footprintScale = footprintMax >= 1000 ? 1 / 1000 : 1;
  const footprintUnitFullLabel = footprintMax >= 1000 ? 't' : 'kg';
  const footprintTitle =
    footprintMax >= 1000 ? t('Carbon Footprint (t)') : t('Carbon Footprint (kg)');

  const footprintData = useMemo(
    () => mapPoints(primaryPoints, range, 'co2e_kg', footprintScale, primaryBucket),
    [primaryPoints, range, footprintScale, primaryBucket]
  );
  const taxData = useMemo(
    () => mapPoints(primaryPoints, range, 'tax_cumulative_eur', 1, primaryBucket),
    [primaryPoints, range, primaryBucket]
  );
  const warmingData = useMemo(
    () => mapPoints(primaryPoints, range, warmingValueKey, 1, primaryBucket),
    [primaryPoints, range, warmingValueKey, primaryBucket]
  );
  const compareOneFootprintData = useMemo(
    () =>
      compareAId
        ? mapPoints(compareAPoints, range, 'co2e_kg', footprintScale, compareABucket)
        : [],
    [compareAId, compareAPoints, range, footprintScale, compareABucket]
  );
  const compareOneTaxData = useMemo(
    () =>
      compareAId
        ? mapPoints(compareAPoints, range, 'tax_cumulative_eur', 1, compareABucket)
        : [],
    [compareAId, compareAPoints, range, compareABucket]
  );
  const compareOneWarmingData = useMemo(
    () =>
      compareAId
        ? mapPoints(compareAPoints, range, warmingValueKey, 1, compareABucket)
        : [],
    [compareAId, compareAPoints, range, warmingValueKey, compareABucket]
  );
  const compareTwoFootprintData = useMemo(
    () =>
      compareBId
        ? mapPoints(compareBPoints, range, 'co2e_kg', footprintScale, compareBBucket)
        : [],
    [compareBId, compareBPoints, range, footprintScale, compareBBucket]
  );
  const compareTwoTaxData = useMemo(
    () =>
      compareBId
        ? mapPoints(compareBPoints, range, 'tax_cumulative_eur', 1, compareBBucket)
        : [],
    [compareBId, compareBPoints, range, compareBBucket]
  );
  const compareTwoWarmingData = useMemo(
    () =>
      compareBId
        ? mapPoints(compareBPoints, range, warmingValueKey, 1, compareBBucket)
        : [],
    [compareBId, compareBPoints, range, warmingValueKey, compareBBucket]
  );

  const footprintTotalKg = useMemo(() => {
    if (Number.isFinite(primaryTotals?.co2e_kg_total)) {
      return primaryTotals.co2e_kg_total;
    }
    return sumPointValues(primaryPoints, 'co2e_kg');
  }, [primaryTotals, primaryPoints]);
  const compareOneFootprintTotalKg = useMemo(() => {
    if (!compareAId) return 0;
    if (Number.isFinite(compareATotals?.co2e_kg_total)) {
      return compareATotals.co2e_kg_total;
    }
    return sumPointValues(compareAPoints, 'co2e_kg');
  }, [compareAId, compareATotals, compareAPoints]);
  const compareTwoFootprintTotalKg = useMemo(() => {
    if (!compareBId) return 0;
    if (Number.isFinite(compareBTotals?.co2e_kg_total)) {
      return compareBTotals.co2e_kg_total;
    }
    return sumPointValues(compareBPoints, 'co2e_kg');
  }, [compareBId, compareBTotals, compareBPoints]);
  const footprintTotalDisplay = useMemo(
    () => footprintTotalKg * footprintScale,
    [footprintTotalKg, footprintScale]
  );
  const compareOneFootprintTotalDisplay = useMemo(
    () => compareOneFootprintTotalKg * footprintScale,
    [compareOneFootprintTotalKg, footprintScale]
  );
  const compareTwoFootprintTotalDisplay = useMemo(
    () => compareTwoFootprintTotalKg * footprintScale,
    [compareTwoFootprintTotalKg, footprintScale]
  );
  const taxTotal = useMemo(
    () =>
      Number.isFinite(primaryTotals?.tax_total_eur)
        ? primaryTotals.tax_total_eur
        : lastPointValue(primaryPoints, 'tax_cumulative_eur'),
    [primaryTotals, primaryPoints]
  );
  const compareOneTaxTotal = useMemo(
    () =>
      compareAId && Number.isFinite(compareATotals?.tax_total_eur)
        ? compareATotals.tax_total_eur
        : lastPointValue(compareAPoints, 'tax_cumulative_eur'),
    [compareAId, compareATotals, compareAPoints]
  );
  const compareTwoTaxTotal = useMemo(
    () =>
      compareBId && Number.isFinite(compareBTotals?.tax_total_eur)
        ? compareBTotals.tax_total_eur
        : lastPointValue(compareBPoints, 'tax_cumulative_eur'),
    [compareBId, compareBTotals, compareBPoints]
  );

  const warmingLatest = warmingData.length ? warmingData[warmingData.length - 1].value : 0;
  const warmingDelta =
    warmingData.length > 1 ? warmingLatest - warmingData[0].value : 0;
  const warmingTrend =
    warmingDelta > warmingThreshold
      ? 'up'
      : warmingDelta < -warmingThreshold
        ? 'down'
        : 'flat';
  const warmingLabel =
    warmingTrend === 'down' ? t('Decrease') : warmingTrend === 'flat' ? t('Stable') : t('Increase');
  const warmingArrow =
    warmingTrend === 'down' ? '\u2193' : warmingTrend === 'flat' ? '\u2192' : '\u2191';

  const compareOneWarmingLatest = compareOneWarmingData.length
    ? compareOneWarmingData[compareOneWarmingData.length - 1].value
    : 0;
  const compareOneWarmingDelta =
    compareOneWarmingData.length > 1
      ? compareOneWarmingLatest - compareOneWarmingData[0].value
      : 0;
  const compareOneWarmingTrend =
    compareOneWarmingDelta > warmingThreshold
      ? 'up'
      : compareOneWarmingDelta < -warmingThreshold
        ? 'down'
        : 'flat';
  const compareOneWarmingLabel =
    compareOneWarmingTrend === 'down'
      ? t('Decrease')
      : compareOneWarmingTrend === 'flat'
        ? t('Stable')
        : t('Increase');
  const compareOneWarmingArrow =
    compareOneWarmingTrend === 'down'
      ? '\u2193'
      : compareOneWarmingTrend === 'flat'
        ? '\u2192'
        : '\u2191';

  const compareTwoWarmingLatest = compareTwoWarmingData.length
    ? compareTwoWarmingData[compareTwoWarmingData.length - 1].value
    : 0;
  const compareTwoWarmingDelta =
    compareTwoWarmingData.length > 1
      ? compareTwoWarmingLatest - compareTwoWarmingData[0].value
      : 0;
  const compareTwoWarmingTrend =
    compareTwoWarmingDelta > warmingThreshold
      ? 'up'
      : compareTwoWarmingDelta < -warmingThreshold
        ? 'down'
        : 'flat';
  const compareTwoWarmingLabel =
    compareTwoWarmingTrend === 'down'
      ? t('Decrease')
      : compareTwoWarmingTrend === 'flat'
        ? t('Stable')
        : t('Increase');
  const compareTwoWarmingArrow =
    compareTwoWarmingTrend === 'down'
      ? '\u2193'
      : compareTwoWarmingTrend === 'flat'
        ? '\u2192'
        : '\u2191';

  const liveLabel = t('Live');
  const liveIndicatorLabel = liveEnabled ? t('Live') : t('Paused');

  const toggleLive = () => {
    setLiveEnabled((prev) => !prev);
  };

  const handleLiveKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleLive();
    }
  };

  const handleCompareOneChange = (event) => {
    const value = event.target.value;
    setCompareA(value);
    if (value !== COMPARE_NONE && value === compareB) {
      setCompareB(COMPARE_NONE);
    }
  };
  const handleCompareTwoChange = (event) => {
    const value = event.target.value;
    if (value !== COMPARE_NONE && value === compareA) {
      setCompareB(COMPARE_NONE);
      return;
    }
    setCompareB(value);
  };
  const handleRangeChange = (event) => {
    const value = event.target.value;
    setRange(value);
    if (value === 'live') {
      setLiveEnabled(true);
    }
  };

  return (
    <div className="reports-container">
      <div className="filter-row reports-header">
        <div className="dashboard-title">{t('Reports')}</div>
        <div className="reports-header-actions">
          <div
            className="reports-live-indicator"
            role="button"
            tabIndex={0}
            aria-pressed={liveEnabled}
            style={{ cursor: 'pointer' }}
            onClick={toggleLive}
            onKeyDown={handleLiveKeyDown}
          >
            {liveEnabled && <span className="reports-live-dot" />}
            {liveIndicatorLabel}
          </div>
          <label className="reports-select-group">
            <span className="reports-select-label">{t('Compare A')}</span>
            <select
              className="reports-country-select"
              value={compareA}
              onChange={handleCompareOneChange}
              aria-label={t('Compare municipality A')}
            >
              <option value={COMPARE_NONE}>{t('No comparison')}</option>
              {municipalityOptions.map((municipality) => (
                <option
                  key={municipality.id}
                  value={municipality.id}
                  disabled={municipality.id === compareB}
                >
                  {municipality.label}
                </option>
              ))}
            </select>
          </label>
          <label className="reports-select-group">
            <span className="reports-select-label">{t('Compare B')}</span>
            <select
              className="reports-country-select"
              value={compareB}
              onChange={handleCompareTwoChange}
              aria-label={t('Compare municipality B')}
            >
              <option value={COMPARE_NONE}>{t('No comparison')}</option>
              {municipalityOptions.map((municipality) => (
                <option
                  key={municipality.id}
                  value={municipality.id}
                  disabled={municipality.id === compareA}
                >
                  {municipality.label}
                </option>
              ))}
            </select>
          </label>
          <label className="reports-select-group">
            <span className="reports-select-label">{t('Range')}</span>
            <select
              className="reports-range-select"
              value={range}
              onChange={handleRangeChange}
              aria-label={t('Report range')}
            >
              <option value="data" hidden>
                {t('Auto')}
              </option>
              <option value="12m">{t('Last 12 Months')}</option>
              <option value="30d">{t('Last 30 Days')}</option>
              <option value="24h">{t('Last 24 Hours')}</option>
              <option value="live">{t('Live')}</option>
            </select>
          </label>
        </div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {loading && !footprintData.length && (
        <div className="loading-state">{t('Loading...')}</div>
      )}

      <div className={`reports-grid${isComparing ? ' reports-grid--compare' : ''}`}>
        <div className="panel report-card">
          <div className="report-card-main">
            <div className="report-card-title">{footprintTitle}</div>
            <div className={`report-chart-grid${isComparing ? ' report-chart-grid--compare' : ''}`}>
              <div className="report-chart-panel">
                <div className="report-chart-label">{liveLabel}</div>
                <div className="report-chart">
                  <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                    <AreaChart
                      data={footprintData}
                      margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorLive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={LIVE_LINE_COLOR} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={LIVE_LINE_COLOR} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        minTickGap={30}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 'auto']}
                        width={45}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        tickFormatter={(value) => formatFootprintValue(value)}
                        label={{
                          value: footprintUnitFullLabel,
                          angle: -90,
                          position: 'insideLeft',
                          offset: -2,
                          fill: 'var(--text-muted)',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: 'none',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          fontSize: '11px',
                        }}
                        formatter={(value) => formatFootprintValue(value)}
                      />
                      <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={liveLabel}
                        stroke={LIVE_LINE_COLOR}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorLive)"
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {compareAId && (
                <div className="report-chart-panel report-chart-panel--compare">
                  <div className="report-chart-label">{compareOneLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <AreaChart
                        data={compareOneFootprintData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorCompareOne" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COMPARE_LINE_COLOR} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COMPARE_LINE_COLOR} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={45}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatFootprintValue(value)}
                          label={{
                            value: footprintUnitFullLabel,
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatFootprintValue(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name={compareOneLabel}
                          stroke={COMPARE_LINE_COLOR}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorCompareOne)"
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-chart-panel report-chart-panel--compare-alt">
                  <div className="report-chart-label">{compareTwoLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <AreaChart
                        data={compareTwoFootprintData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorCompareTwo" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COMPARE_TWO_LINE_COLOR} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COMPARE_TWO_LINE_COLOR} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={45}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatFootprintValue(value)}
                          label={{
                            value: footprintUnitFullLabel,
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatFootprintValue(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name={compareTwoLabel}
                          stroke={COMPARE_TWO_LINE_COLOR}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorCompareTwo)"
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="report-card-summary">
            <div className="report-icon report-icon--footprint" aria-hidden="true">
              <svg id="Capa_1" enableBackground="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <circle cx="348.5" cy="77" r="55" />
                  <circle cx="233.5" cy="45" r="45" />
                  <circle cx="128.5" cy="77" r="45" />
                  <circle cx="48.5" cy="157" r="45" />
                  <path d="m286.059 369.113c-8.426-21.133-17.139-42.985-15.724-59.784 1.51-17.916 10.235-37.54 25.934-58.327 13.349-17.676 31.631-41.883 26.295-71.892-3.253-18.298-12.835-33.15-27.71-42.952-32.165-21.195-78.369-13.499-96.742-9.205-8.563 2.001-70.054 24.47-90.761 64.667-17.308 33.599-15.224 70.526-10.394 105.427 5.743 41.492 12.812 75.213 22.244 106.122l.111.364c9.457 30.989 20.176 66.112 48.576 89.34 14.53 11.871 33.145 18.654 52.417 19.102.683.016 1.364.023 2.046.023 18.333 0 36.429-5.708 51.165-16.177 21.977-15.613 32.327-36.829 30.762-63.058-1.259-21.115-9.881-42.739-18.219-63.65z" />
                  <path d="m478.5 312c0-24.813-20.187-45-45-45s-45 20.187-45 45 20.187 45 45 45 45-20.187 45-45zm-45 25c-13.785 0-25-11.215-25-25s11.215-25 25-25 25 11.215 25 25-11.215 25-25 25z" />
                  <path d="m374.927 329.458c-4.232-3.549-10.54-2.997-14.088 1.235-.573.684-1.188 1.319-1.83 1.89-3.291 2.931-7.516 4.417-12.558 4.417-13.785 0-25-11.215-25-25s11.215-25 25-25c5.012 0 9.842 1.474 13.969 4.263 4.576 3.092 10.793 1.889 13.885-2.687s1.889-10.792-2.687-13.885c-7.447-5.032-16.149-7.692-25.167-7.692-24.813 0-45 20.187-45 45s20.187 45 45 45c9.953 0 18.895-3.279 25.858-9.48 1.362-1.212 2.658-2.549 3.853-3.973 3.549-4.231 2.996-10.538-1.235-14.088z" />
                  <path d="m498.374 416.865c-3.566.044-7.281.081-10.811.104 2.743-3.752 6.076-8.394 10.087-14.125 4.062-5.805 6.616-11.121 7.805-16.251.245-1.298.515-3.215.549-4.534 0-13.817-11.241-25.059-25.058-25.059-11.947 0-22.288 8.5-24.588 20.212-1.064 5.419 2.466 10.676 7.885 11.74 5.418 1.063 10.676-2.466 11.74-7.885.463-2.357 2.55-4.067 4.963-4.067 2.631 0 4.799 2.02 5.037 4.59l-.115.901c-.485 1.803-1.686 4.716-4.604 8.886-9.282 13.262-14.817 20.509-17.791 24.403-3.859 5.053-6.409 8.392-4.768 13.728.974 3.166 3.456 5.689 6.643 6.752 1.328.443 2.276.759 14.03.759 4.566 0 10.763-.048 19.246-.155 5.522-.069 9.943-4.602 9.874-10.125-.068-5.523-4.576-9.961-10.124-9.874z" />
                </g>
              </svg>
            </div>
            <div className={`report-summary-grid${isComparing ? ' report-summary-grid--compare' : ''}`}>
              <div className="report-summary-block report-summary-block--live">
                <div className="report-summary-label">{liveLabel}</div>
                <div className="report-total">
                  <div className="report-total-value">
                    {footprintTotalDisplay.toFixed(1)} <span>{footprintUnitFullLabel}</span>
                  </div>
                  <div className="report-total-label">{t('Total')}</div>
                </div>
              </div>
              {compareAId && (
                <div className="report-summary-block report-summary-block--compare">
                  <div className="report-summary-label">{compareOneLabel}</div>
                  <div className="report-total">
                    <div className="report-total-value">
                      {compareOneFootprintTotalDisplay.toFixed(1)} <span>{footprintUnitFullLabel}</span>
                    </div>
                    <div className="report-total-label">{t('Total')}</div>
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-summary-block report-summary-block--compare-alt">
                  <div className="report-summary-label">{compareTwoLabel}</div>
                  <div className="report-total">
                    <div className="report-total-value">
                      {compareTwoFootprintTotalDisplay.toFixed(1)} <span>{footprintUnitFullLabel}</span>
                    </div>
                    <div className="report-total-label">{t('Total')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel report-card">
          <div className="report-card-main">
            <div className="report-card-title">{t('Carbon Tax Pay (EUR)')}</div>
            <div className={`report-chart-grid${isComparing ? ' report-chart-grid--compare' : ''}`}>
              <div className="report-chart-panel">
                <div className="report-chart-label">{liveLabel}</div>
                <div className="report-chart">
                  <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                    <AreaChart data={taxData} margin={{ top: 20, right: 18, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTax" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={LIVE_LINE_COLOR} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={LIVE_LINE_COLOR} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        minTickGap={30}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 'auto']}
                        width={55}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        tickFormatter={(value) => formatEuro(value)}
                        label={{
                          value: 'EUR',
                          angle: -90,
                          position: 'insideLeft',
                          offset: -2,
                          fill: 'var(--text-muted)',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: 'none',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          fontSize: '11px',
                        }}
                        formatter={(value) => formatEuro(value)}
                      />
                      <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={liveLabel}
                        stroke={LIVE_LINE_COLOR}
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorTax)"
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {compareAId && (
                <div className="report-chart-panel report-chart-panel--compare">
                  <div className="report-chart-label">{compareOneLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <AreaChart
                        data={compareOneTaxData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorTaxCompareOne" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COMPARE_LINE_COLOR} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COMPARE_LINE_COLOR} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={55}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatEuro(value)}
                          label={{
                            value: 'EUR',
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatEuro(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name={compareOneLabel}
                          stroke={COMPARE_LINE_COLOR}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorTaxCompareOne)"
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-chart-panel report-chart-panel--compare-alt">
                  <div className="report-chart-label">{compareTwoLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <AreaChart
                        data={compareTwoTaxData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="colorTaxCompareTwo" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COMPARE_TWO_LINE_COLOR} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COMPARE_TWO_LINE_COLOR} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={55}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatEuro(value)}
                          label={{
                            value: 'EUR',
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatEuro(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name={compareTwoLabel}
                          stroke={COMPARE_TWO_LINE_COLOR}
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorTaxCompareTwo)"
                          activeDot={{ r: 4, strokeWidth: 0 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="report-card-summary">
            <div className="report-icon report-icon--tax" aria-hidden="true">
              <svg id="Capa_1" enableBackground="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg">
                <g>
                  <g>
                    <path d="m86 10h340v492h-340z" fill="#000" transform="matrix(-1 0 0 -1 512 512)" />
                  </g>
                  <g>
                    <path d="m433.07 2.93c-1.86-1.861-4.43-2.93-7.07-2.93h-340c-2.63 0-5.21 1.069-7.07 2.93-1.86 1.86-2.93 4.429-2.93 7.07v492c0 2.63 1.07 5.21 2.93 7.069 1.86 1.861 4.44 2.931 7.07 2.931h340c2.63 0 5.21-1.07 7.07-2.931 1.86-1.859 2.93-4.439 2.93-7.069v-64c0-5.521-4.49-10-10-10s-10 4.479-10 10v54h-320v-472h320v328c0 5.51 4.49 10 10 10s10-4.49 10-10v-338c0-2.641-1.07-5.21-2.93-7.07z" />
                    <circle cx="426" cy="393" r="10" />
                    <path d="m198.917 251.816c3.375-4.373 2.565-10.652-1.807-14.026-4.373-3.376-10.652-2.564-14.026 1.806-.633.821-1.315 1.586-2.026 2.274-3.516 3.402-7.973 5.128-13.248 5.128-14.783 0-26.81-13.458-26.81-30s12.027-30 26.81-30c5.232 0 10.303 1.691 14.663 4.893 4.453 3.268 10.711 2.31 13.979-2.145 3.268-4.452 2.308-10.71-2.144-13.979-7.816-5.737-16.979-8.77-26.498-8.77-25.811 0-46.81 22.43-46.81 50s20.999 50 46.81 50c10.495 0 19.885-3.72 27.157-10.757 1.401-1.355 2.73-2.844 3.95-4.424z" />
                    <path d="m221 216.998c0 27.57 22.43 50 50 50s50-22.43 50-50-22.43-50-50-50-50 22.43-50 50zm80 0c0 16.542-13.458 30-30 30s-30-13.458-30-30 13.458-30 30-30 30 13.458 30 30z" />
                    <path d="m391 261.998c0-16.542-13.458-30-30-30s-30 13.458-30 30c0 5.522 4.477 10 10 10s10-4.478 10-10c0-5.514 4.486-10 10-10s10 4.486 10 10c0 8.218-35 33.552-38.031 38.041-2.115 3.132-2.601 7.079-.902 10.454 1.698 3.375 5.154 5.505 8.933 5.505h40c5.523 0 10-4.478 10-10s-4.477-10-10-10h-16.536c1.216-1.104 26.536-18.782 26.536-34z" />
                    <path d="m153.5 471.998c5.523 0 10-4.478 10-10v-13.418c15.429-4.168 25.111-16.948 27.093-29.562 2.571-16.363-6.636-30.512-23.456-36.046-9.535-3.137-20.083-6.929-26.028-11.27-2.081-1.519-2.375-4.542-1.955-6.864.604-3.342 3.027-7.412 8.021-8.812 6.868-1.925 13.971.269 18.872 2.561 4.032 1.886 8.828.875 11.847-2.396 4.758-5.154 3.105-13.454-3.271-16.378-3.197-1.466-6.951-2.823-11.124-3.706v-12.109c0-5.522-4.477-10-10-10s-10 4.478-10 10v12.345c-11.588 2.912-21 11.724-23.713 23.416-2.575 11.101 1.166 21.993 9.53 28.097 6.6 4.819 15.747 8.908 31.57 14.114 10.043 3.304 10.543 10.154 9.948 13.943-1.058 6.734-7.155 14.013-18.042 14.08-10.37.086-13.617-.413-21.593-5.27-4.885-2.972-11.308-1.265-14.034 3.855-2.524 4.74-.628 10.658 3.97 13.432 8.717 5.259 14.916 7.124 22.364 7.726v12.261c.001 5.524 4.478 10.001 10.001 10.001z" />
                    <path d="m278.401 127.379s-21.435-78.99-21.452-79.05c-1.45-4.979-5.785-8.326-10.787-8.331-.003 0-.006 0-.01 0-4.997 0-9.333 3.339-10.791 8.31-.021.072-21.269 79.094-21.269 79.094-1.434 5.334 1.728 10.819 7.061 12.254 5.333 1.433 10.82-1.727 12.254-7.061l3.291-12.24h19.073l3.328 12.263c1.208 4.453 5.242 7.384 9.645 7.384.867 0 1.748-.114 2.625-.352 5.33-1.447 8.478-6.941 7.032-12.271zm-36.326-27.024 4.115-15.307 4.154 15.307z" />
                    <path d="m304.278 138.942c1.436.718 2.961 1.058 4.464 1.058 3.668 0 7.2-2.025 8.952-5.53l11.056-22.111 11.056 22.111c1.752 3.505 5.284 5.53 8.952 5.53 1.502 0 3.029-.34 4.464-1.058 4.94-2.47 6.942-8.477 4.472-13.416l-17.764-35.528 17.764-35.528c2.47-4.939.468-10.946-4.472-13.416s-10.947-.469-13.417 4.473l-11.055 22.111-11.056-22.111c-2.47-4.939-8.475-6.941-13.417-4.473-4.94 2.47-6.942 8.477-4.472 13.416l17.764 35.528-17.764 35.528c-2.469 4.94-.467 10.947 4.473 13.416z" />
                    <path d="m213.25 49.998c0-5.522-4.477-10-10-10h-40c-5.523 0-10 4.478-10 10s4.477 10 10 10h10.081v70c0 5.522 4.477 10 10 10s10-4.478 10-10v-70h9.919c5.523 0 10-4.477 10-10z" />
                    <path d="m386 382.998h-162c-5.523 0-10 4.478-10 10s4.477 10 10 10h162c5.523 0 10-4.478 10-10s-4.477-10-10-10z" />
                    <path d="m386 342.998h-58c-5.523 0-10 4.478-10 10s4.477 10 10 10h58c5.523 0 10-4.478 10-10s-4.477-10-10-10z" />
                    <path d="m224 342.998c-5.523 0-10 4.478-10 10s4.477 10 10 10h59c5.523 0 10-4.478 10-10s-4.477-10-10-10z" />
                    <path d="m386 422.998h-58c-5.523 0-10 4.478-10 10s4.477 10 10 10h58c5.523 0 10-4.478 10-10s-4.477-10-10-10z" />
                    <path d="m224 422.998c-5.523 0-10 4.478-10 10s4.477 10 10 10h59c5.523 0 10-4.478 10-10s-4.477-10-10-10z" />
                  </g>
                </g>
              </svg>
            </div>
            <div className={`report-summary-grid${isComparing ? ' report-summary-grid--compare' : ''}`}>
              <div className="report-summary-block report-summary-block--live">
                <div className="report-summary-label">{liveLabel}</div>
                <div className="report-total">
                  <div className="report-total-value">
                    {formatEuro(taxTotal)} <span>&euro;</span>
                  </div>
                  <div className="report-total-label">{t('Total')}</div>
                </div>
              </div>
              {compareAId && (
                <div className="report-summary-block report-summary-block--compare">
                  <div className="report-summary-label">{compareOneLabel}</div>
                  <div className="report-total">
                    <div className="report-total-value">
                      {formatEuro(compareOneTaxTotal)} <span>&euro;</span>
                    </div>
                    <div className="report-total-label">{t('Total')}</div>
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-summary-block report-summary-block--compare-alt">
                  <div className="report-summary-label">{compareTwoLabel}</div>
                  <div className="report-total">
                    <div className="report-total-value">
                      {formatEuro(compareTwoTaxTotal)} <span>&euro;</span>
                    </div>
                    <div className="report-total-label">{t('Total')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel report-card">
          <div className="report-card-main">
            <div className="report-card-title">
              {t('Global Warming')} ({warmingUnitLabel})
            </div>
            <div className={`report-chart-grid${isComparing ? ' report-chart-grid--compare' : ''}`}>
              <div className="report-chart-panel">
                <div className="report-chart-label">{liveLabel}</div>
                <div className="report-chart">
                  <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                    <BarChart data={warmingData} margin={{ top: 20, right: 18, left: 10, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        minTickGap={30}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 'auto']}
                        width={45}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                        tickFormatter={(value) => formatWarmingValue(value)}
                        label={{
                          value: warmingUnitLabel,
                          angle: -90,
                          position: 'insideLeft',
                          offset: -2,
                          fill: 'var(--text-muted)',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: 'none',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          fontSize: '11px',
                        }}
                        formatter={(value) => formatWarmingValue(value)}
                      />
                      <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                      <Bar
                        dataKey="value"
                        name={liveLabel}
                        radius={[2, 2, 0, 0]}
                        barSize={20}
                      >
                        {warmingData.map((entry, index) => (
                          <Cell
                            key={`live-${entry.bucket || entry.label}`}
                            fill={WARMING_COLORS[index % WARMING_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {compareAId && (
                <div className="report-chart-panel report-chart-panel--compare">
                  <div className="report-chart-label">{compareOneLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <BarChart
                        data={compareOneWarmingData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={45}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatWarmingValue(value)}
                          label={{
                            value: warmingUnitLabel,
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatWarmingValue(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Bar
                          dataKey="value"
                          name={compareOneLabel}
                          radius={[2, 2, 0, 0]}
                          barSize={20}
                        >
                          {compareOneWarmingData.map((entry, index) => (
                            <Cell
                              key={`compare-one-${entry.bucket || entry.label}`}
                              fill={WARMING_COLORS[index % WARMING_COLORS.length]}
                              fillOpacity={0.55}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-chart-panel report-chart-panel--compare-alt">
                  <div className="report-chart-label">{compareTwoLabel}</div>
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%" minHeight={190}>
                      <BarChart
                        data={compareTwoWarmingData}
                        margin={{ top: 20, right: 18, left: 10, bottom: 0 }}
                      >
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          minTickGap={30}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          domain={[0, 'auto']}
                          width={45}
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          tickFormatter={(value) => formatWarmingValue(value)}
                          label={{
                            value: warmingUnitLabel,
                            angle: -90,
                            position: 'insideLeft',
                            offset: -2,
                            fill: 'var(--text-muted)',
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: 8,
                            border: 'none',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            fontSize: '11px',
                          }}
                          formatter={(value) => formatWarmingValue(value)}
                        />
                        <Legend verticalAlign="top" height={24} iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        <Bar
                          dataKey="value"
                          name={compareTwoLabel}
                          radius={[2, 2, 0, 0]}
                          barSize={20}
                        >
                          {compareTwoWarmingData.map((entry, index) => (
                            <Cell
                              key={`compare-two-${entry.bucket || entry.label}`}
                              fill={WARMING_COLORS[index % WARMING_COLORS.length]}
                              fillOpacity={0.55}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="report-card-summary">
            <div className="report-icon report-icon--warming" aria-hidden="true">
              <svg fill="#000000" height="800px" width="800px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink"
                viewBox="0 0 512 512" xmlSpace="preserve">
                <g>
                  <g>
                    <g>
                      <path d="M156.834,38.554C188.041,24.294,221.406,17.067,256,17.067c17.289,0,34.475,1.843,51.191,5.495
                      c-0.759,14.362,5.291,23.962,9.515,30.66c1.186,1.886,2.807,4.463,2.978,5.171c0,35.251-7.134,42.667-8.533,42.667
                      c-15.36,0-41.566,14.319-51.081,32.094c-5.828,10.872-5.359,22.374,1.314,32.375c4.813,7.219,8.934,15.215,12.928,22.938
                      c8.218,15.915,17.331,33.579,31.343,33.579c2.884,0,5.973-0.751,9.31-2.415c11.136-5.572,19.302-21.769,27.204-37.427
                      c3.763-7.458,9.336-18.509,12.484-21.325c11.204,1.109,16.358,10.556,23.356,25.711c4.787,10.368,9.737,21.094,19.243,25.848
                      c16.478,8.218,70.844-0.538,100.983-13.338c0.358-0.154,0.597-0.444,0.922-0.631c0.495-0.299,0.973-0.58,1.399-0.956
                      c0.41-0.375,0.734-0.794,1.058-1.237c0.324-0.427,0.631-0.853,0.87-1.34c0.247-0.495,0.384-0.998,0.529-1.536
                      c0.137-0.521,0.265-1.024,0.307-1.579c0.034-0.572-0.034-1.118-0.111-1.698c-0.051-0.375,0.026-0.734-0.077-1.109
                      c-20.659-76.399-76.791-139.955-150.161-170.001c-4.36-1.783-9.344,0.299-11.127,4.659c-1.783,4.361,0.299,9.344,4.659,11.128
                      c66.116,27.085,117.146,83.345,137.95,151.364c-31.795,11.546-72.166,14.711-79.573,10.999
                      c-4.147-2.074-7.825-10.027-11.375-17.724c-6.758-14.635-16.009-34.671-39.313-35.703c-11.52-0.41-18.099,12.612-27.264,30.78
                      c-5.7,11.315-13.517,26.812-19.593,29.85c-4.42,2.227-11.58-11.554-17.86-23.723c-4.011-7.765-8.55-16.572-13.892-24.576
                      c-3.191-4.779-3.336-9.506-0.469-14.865c7.134-13.329,27.93-23.074,36.036-23.074c16.99,0,25.6-20.096,25.6-59.733
                      c0-5.367-2.722-9.685-5.606-14.268c-4.343-6.878-8.823-13.995-6.135-26.274c0.99-4.506-1.784-8.969-6.246-10.103
                      C298.377,2.611,277.257,0,256,0c-37.06,0-72.806,7.748-106.257,23.023c-4.284,1.963-6.17,7.023-4.215,11.307
                      C147.49,38.622,152.55,40.516,156.834,38.554z"/>
                      <path d="M375.117,262.46c-3.132,0.896-7.031,2.014-8.183,2.074c-13.03,0-21.129,9.882-27.622,17.826
                      c-2.978,3.644-7.492,9.148-9.719,9.148c-0.367,0-0.896-0.162-1.51-0.469c-4.284-2.15-8.772-3.226-13.355-3.226
                      c-11.042,0-20.591,6.502-22.707,15.471c-1.468,6.229,0.742,14.771,11.366,20.087c16.171,8.081,32.896,16.444,40.448,23.996
                      c4.83,4.83,13.278,7.603,23.185,7.603c15.138,0,35.251-7.339,42.146-28.006c2.91-8.73,10.069-15.582,16.384-21.623
                      c7.33-7.023,14.259-13.653,14.362-22.869c0.06-5.402-2.364-10.598-7.211-15.437c-6.69-6.69-15.846-10.086-27.204-10.086
                      C394.419,256.947,383.266,260.13,375.117,262.46z M422.844,282.283c-0.017,2.039-5.478,7.27-9.097,10.726
                      c-7.364,7.049-16.529,15.812-20.779,28.561c-4.011,12.041-16.034,16.333-25.95,16.333c-6.434,0-10.266-1.749-11.119-2.603
                      c-9.515-9.515-26.692-18.108-44.885-27.196c-0.998-0.503-1.647-0.973-2.031-1.306c1.374-1.331,6.699-2.884,11.469-0.495
                      c3.012,1.502,6.093,2.27,9.139,2.27c10.317-0.008,17.015-8.183,22.929-15.403c5.717-6.989,9.805-11.571,14.413-11.571
                      c3.328,0,7.33-1.143,12.877-2.731c7.177-2.048,16.998-4.855,25.685-4.855c6.758,0,11.716,1.664,15.138,5.086
                      C422.46,280.926,422.852,282.018,422.844,282.283z"/>
                      <path d="M215.834,364.433c1.664,1.664,3.849,2.5,6.033,2.5c2.185,0,4.369-0.836,6.033-2.5
                      c9.481-9.481,13.73-20.693,11.964-31.573c-1.442-8.858-7.006-16.905-14.182-20.497c-3.072-1.527-7.1-2.705-11.767-4.062
                      c-8.431-2.458-21.171-6.17-24.329-12.194c-0.649-1.246-1.348-3.371,0.034-7.543c2.517-7.544,4.804-11.836,6.81-15.625
                      c5.504-10.334,8.371-17.101,8.371-46.805c0-15.625-7.501-27.733-21.137-34.082c-4.258-1.971-9.336-0.137-11.332,4.139
                      c-1.988,4.275-0.137,9.344,4.13,11.341c7.484,3.482,11.273,9.737,11.273,18.603c0,26.829-2.398,31.326-6.366,38.784
                      c-2.21,4.164-4.975,9.344-7.936,18.253c-2.551,7.654-2.202,14.669,1.041,20.855c6.528,12.467,22.793,17.203,34.671,20.659
                      c3.55,1.033,7.211,2.099,8.909,2.953c1.604,0.802,4.25,3.576,4.966,7.953c0.87,5.402-1.613,11.204-7.185,16.777
                      C212.497,355.703,212.497,361.097,215.834,364.433z"/>
                      <path d="M93.867,452.267c0,4.71,3.823,8.533,8.533,8.533c28.237,0,51.2-22.963,51.2-51.2c0-4.71-3.823-8.533-8.533-8.533
                      c-4.71,0-8.533,3.823-8.533,8.533c0,18.825-15.309,34.133-34.133,34.133C97.69,443.733,93.867,447.556,93.867,452.267z"/>
                      <path d="M509.568,220.57c-0.64-4.668-5.001-7.936-9.626-7.279c-4.668,0.64-7.927,4.949-7.279,9.626
                      c1.51,10.871,2.27,22.008,2.27,33.084c0,131.746-107.187,238.933-238.933,238.933c-37.026,0-56.047-7.714-56.405-7.859
                      c-4.309-1.826-9.327,0.171-11.17,4.497c-1.86,4.335,0.154,9.353,4.48,11.204C193.783,503.151,214.904,512,256,512
                      c141.158,0,256-114.842,256-256C512,244.139,511.181,232.218,509.568,220.57z"/>
                      <path d="M153.6,320.998V85.333c0-28.237-22.963-51.2-51.2-51.2c-28.237,0-51.2,22.963-51.2,51.2v8.533
                      c0,4.71,3.823,8.533,8.533,8.533s8.533-3.823,8.533-8.533v-8.533c0-18.825,15.309-34.133,34.133-34.133
                      c18.825,0,34.133,15.309,34.133,34.133v240.725c0,3.209,1.792,6.144,4.642,7.603c28.723,14.694,46.558,43.793,46.558,75.938
                      c0,47.053-38.281,85.333-85.333,85.333S17.067,456.653,17.067,409.6c0-32.145,17.835-61.244,46.558-75.938
                      c2.85-1.459,4.642-4.395,4.642-7.603v-35.925H76.8c4.71,0,8.533-3.823,8.533-8.533s-3.823-8.533-8.533-8.533h-8.533v-34.133H76.8
                      c4.71,0,8.533-3.823,8.533-8.533s-3.823-8.533-8.533-8.533h-8.533v-34.133H76.8c4.71,0,8.533-3.823,8.533-8.533
                      s-3.823-8.533-8.533-8.533h-8.533v-34.133h42.667c4.71,0,8.533-3.823,8.533-8.533s-3.823-8.533-8.533-8.533h-51.2
                      c-4.71,0-8.533,3.823-8.533,8.533v192.998C19.49,339.302,0,372.787,0,409.6C0,466.065,45.935,512,102.4,512
                      c56.465,0,102.4-45.935,102.4-102.4C204.8,372.787,185.31,339.302,153.6,320.998z"/>
                      <path d="M258.884,460.143c9.02,0,17.442-3.243,23.1-8.9c12.988-12.988,2.825-34.833-8.533-46.199
                      c-2.603-2.603-6.016-3.977-9.873-3.977c-11.81,0-25.745,13.764-30.865,26.129c-3.908,9.429-2.782,18.193,3.072,24.047
                      C241.442,456.9,249.865,460.143,258.884,460.143z M248.192,434.475c2.697-7.424,10.65-14.635,14.404-16.085
                      c6.562,7.296,10.359,17.749,7.322,20.787c-4.89,4.89-17.186,4.881-22.067,0C247.108,438.434,247.569,436.173,248.192,434.475z"/>
                    </g>
                  </g>
                </g>
              </svg>
            </div>
            <div className={`report-summary-grid${isComparing ? ' report-summary-grid--compare' : ''}`}>
              <div className="report-summary-block report-summary-block--live">
                <div className="report-summary-label">{liveLabel}</div>
                <div className="report-delta">
                  <span
                    className={`report-delta-arrow${warmingTrend === 'down'
                        ? ' report-delta-arrow--down'
                        : warmingTrend === 'flat'
                          ? ' report-delta-arrow--flat'
                          : ''
                      }`}
                  >
                    {warmingArrow}
                  </span>
                  <div className="report-delta-value">
                    {formatWarmingValue(Math.abs(warmingLatest))}{' '}
                    <span className="report-unit">{warmingUnitLabel}</span>
                  </div>
                </div>
                <div
                  className={`report-delta-badge${warmingTrend === 'down'
                      ? ' report-delta-badge--down'
                      : warmingTrend === 'flat'
                        ? ' report-delta-badge--flat'
                        : ''
                    }`}
                >
                  {warmingLabel}
                </div>
              </div>
              {compareAId && (
                <div className="report-summary-block report-summary-block--compare">
                  <div className="report-summary-label">{compareOneLabel}</div>
                  <div className="report-delta">
                    <span
                      className={`report-delta-arrow${compareOneWarmingTrend === 'down'
                          ? ' report-delta-arrow--down'
                          : compareOneWarmingTrend === 'flat'
                            ? ' report-delta-arrow--flat'
                            : ''
                        }`}
                    >
                      {compareOneWarmingArrow}
                    </span>
                    <div className="report-delta-value">
                      {formatWarmingValue(Math.abs(compareOneWarmingLatest))}{' '}
                      <span className="report-unit">{warmingUnitLabel}</span>
                    </div>
                  </div>
                  <div
                    className={`report-delta-badge${compareOneWarmingTrend === 'down'
                        ? ' report-delta-badge--down'
                        : compareOneWarmingTrend === 'flat'
                          ? ' report-delta-badge--flat'
                          : ''
                      }`}
                  >
                    {compareOneWarmingLabel}
                  </div>
                </div>
              )}
              {compareBId && (
                <div className="report-summary-block report-summary-block--compare-alt">
                  <div className="report-summary-label">{compareTwoLabel}</div>
                  <div className="report-delta">
                    <span
                      className={`report-delta-arrow${compareTwoWarmingTrend === 'down'
                          ? ' report-delta-arrow--down'
                          : compareTwoWarmingTrend === 'flat'
                            ? ' report-delta-arrow--flat'
                            : ''
                        }`}
                    >
                      {compareTwoWarmingArrow}
                    </span>
                    <div className="report-delta-value">
                      {formatWarmingValue(Math.abs(compareTwoWarmingLatest))}{' '}
                      <span className="report-unit">{warmingUnitLabel}</span>
                    </div>
                  </div>
                  <div
                    className={`report-delta-badge${compareTwoWarmingTrend === 'down'
                        ? ' report-delta-badge--down'
                        : compareTwoWarmingTrend === 'flat'
                          ? ' report-delta-badge--flat'
                          : ''
                      }`}
                  >
                    {compareTwoWarmingLabel}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
