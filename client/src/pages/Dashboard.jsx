// Dashboard.jsx
import { useEffect, useState, useRef, useMemo, useCallback, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-defaulticon-compatibility';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';
import L from 'leaflet';
import { io } from 'socket.io-client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import api from '../api';
import ExportDialog from '../components/ExportDialog.jsx';
import { fetchGeneral } from '../api/settingsApi.js';
import { fetchReportMunicipalities } from '../api/reports.js';
import { subscribeToSettings, getSettingsSocket } from '../socket/settingsSocket.js';

const API_BASE_URL =
  (api?.defaults?.baseURL || '').replace(/\/api\/?$/, '') || 'http://localhost:5000';

const DEFAULT_MAP_PREFS = {
  map_view: 'municipality',
  zoom: 12,
  marker_style: 'icons',
  show_registered_cities: true,
  show_recycling_centers: true,
  show_trucks_live: true,
};

const DEFAULT_MAP_CENTER = { lat: 50.3901457, lng: 7.5943503 };
const EMPTY_ARRAY = [];
const MAP_VIEW_VALUES = new Set(['city', 'municipality']);
const MARKER_STYLE_VALUES = new Set(['icons', 'labels']);

function clampZoom(value, fallback = DEFAULT_MAP_PREFS.zoom) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(20, Math.max(1, Math.round(num)));
}

function parseCoord(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function normalizeMapView(value) {
  return MAP_VIEW_VALUES.has(value) ? value : DEFAULT_MAP_PREFS.map_view;
}

function normalizeMarkerStyle(value) {
  return MARKER_STYLE_VALUES.has(value) ? value : DEFAULT_MAP_PREFS.marker_style;
}

function parseBooleanPref(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

const HIDDEN_TRUCK_STATUSES = new Set(['inactive', 'maintenance', 'maintence']);

function normalizeStatus(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function isHiddenStatus(value) {
  return HIDDEN_TRUCK_STATUSES.has(normalizeStatus(value));
}

function sanitizeMapPrefs(raw = {}) {
  return {
    map_view: normalizeMapView(raw.map_view),
    zoom: clampZoom(raw.zoom, DEFAULT_MAP_PREFS.zoom),
    marker_style: normalizeMarkerStyle(raw.marker_style),
    show_registered_cities: parseBooleanPref(
      raw.show_registered_cities,
      DEFAULT_MAP_PREFS.show_registered_cities
    ),
    show_recycling_centers: parseBooleanPref(
      raw.show_recycling_centers,
      DEFAULT_MAP_PREFS.show_recycling_centers
    ),
    show_trucks_live: parseBooleanPref(
      raw.show_trucks_live,
      DEFAULT_MAP_PREFS.show_trucks_live
    ),
  };
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function buildTruckIcon(label) {
  const safeLabel = escapeHtmlAttribute(label);
  return L.divIcon({
    className: 'truck-icon',
    html: `
      <svg viewBox="0 0 64 42" aria-label="${safeLabel}" role="img">
        <defs>
          <linearGradient id="truckBody" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#0ea5e9"/>
          </linearGradient>
          <linearGradient id="truckCab" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#e0f2fe"/>
            <stop offset="100%" stop-color="#bfdbfe"/>
          </linearGradient>
        </defs>
        <rect x="12" y="10" width="32" height="18" rx="3" fill="url(#truckBody)"/>
        <rect x="10" y="8" width="32" height="18" rx="3" fill="url(#truckBody)" opacity="0.85"/>
        <rect x="40" y="16" width="16" height="14" rx="3" fill="url(#truckCab)" stroke="#0f172a" stroke-opacity="0.08"/>
        <rect x="44" y="18" width="6" height="6" rx="1" fill="#0f172a" fill-opacity="0.12"/>
        <circle cx="20" cy="30" r="6" fill="#0f172a"/>
        <circle cx="20" cy="30" r="3" fill="#e2e8f0"/>
        <circle cx="44" cy="30" r="6" fill="#0f172a"/>
        <circle cx="44" cy="30" r="3" fill="#e2e8f0"/>
        <path d="M16 14 L22 8 L22 12 L30 12 L30 16 L22 16 L22 20 Z" fill="#f8fafc" opacity="0.9"/>
      </svg>
    `,
    iconSize: [48, 42],
    iconAnchor: [24, 21],
    popupAnchor: [0, -14],
  });
}

function buildRecyclingIcon(label) {
  const safeLabel = escapeHtmlAttribute(label);
  return L.divIcon({
    className: 'recycling-icon',
    html: `
      <div class="recycling-marker">
        <div class="recycling-marker__icon" aria-label="${safeLabel}" role="img">
          <svg height="32px" width="32px" version="1.1" xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 511.868 511.868" xmlSpace="preserve">
              <circle style="fill:#6B7F9E;" cx="255.934" cy="255.934" r="255.934"/>
              <path style="fill:#5FDC68;" d="M353.358,153.376c9.216-115.46-154.956-165.357-203.01-0.658c0,0,28.174-28.569,53.583-24.093
                c34.888,6.056,58.586,81.888,149.427,24.882V153.376z"/>
              <path style="fill:#FFE356;" d="M367.313,159.959l-5.924,5.398c-35.678-46.474-119.541-111.642-169.701-64.642
                C243.822,46.737,332.688,111.905,367.313,159.959z"/>
              <path style="fill:#5FDC68;" d="M126.914,228.155C22.249,277.92,61.219,444.988,227.76,404.308c0,0-38.838-10.137-47.659-34.362
                C167.858,336.638,221.704,278.184,126.914,228.155z"/>
              <path style="fill:#FFE356;" d="M125.729,212.884l7.636,2.501c-22.513,54.11-36.995,159.432,28.832,179.312
                c-72.804-18.168-60.692-127.704-36.468-181.682V212.884z"/>
              <path style="fill:#5FDC68;" d="M307.147,390.879c95.449,65.695,220.651-51.476,102.163-175.494c0,0,10.664,38.706-5.924,58.454
                c-22.776,27.121-100.32,9.874-96.239,116.908V390.879z"/>
              <path style="fill:#FFE356;" d="M294.509,399.568l-1.711-7.899c58.191-7.636,156.536-47.659,140.869-114.67
                c20.67,72.146-80.177,116.382-139.158,122.438V399.568z"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [140, 70],
    iconAnchor: [70, 18],
    popupAnchor: [0, -6],
  });
}

function buildLabelIcon(label, variant) {
  const safeLabel = escapeHtmlAttribute(label);
  const variantClass = variant ? ` map-label-marker--${variant}` : '';
  return L.divIcon({
    className: 'map-label-icon',
    html: `
      <div class="map-label-marker${variantClass}">
        <span class="map-label-marker__dot"></span>
        <span class="map-label-marker__text">${safeLabel}</span>
      </div>
    `,
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    popupAnchor: [0, -18],
  });
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function formatReduction(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n).toFixed(decimals);
  return n === 0 ? '0' : `-${abs}`;
}

function formatWarming(value) {
  const n = Math.abs(Number(value));
  if (n === 0) return '0.0000';
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}

const colorPalette = ['#0ea5e9', '#f97316', '#22c55e', '#8b5cf6', '#ec4899', '#f59e0b'];
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}
function trailColorFor(truckId) {
  const idx = Math.abs(hashString(String(truckId))) % colorPalette.length;
  return colorPalette[idx];
}

function MapAutoCenter({
  selectedTruckId,
  trucksList,
  optimizedRoutes,
  mapView,
  mapZoom,
  baseCenter,
  showLiveTrucks,
  registeredCities,
  showRegisteredCities,
}) {
  const map = useMap();
  const safeTrucks = useMemo(
    () => trucksList.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng)),
    [trucksList]
  );
  const safeCities = useMemo(
    () => registeredCities.filter((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng)),
    [registeredCities]
  );

  useEffect(() => {
    if (!map) return;

    const targetZoom = clampZoom(mapZoom, map.getZoom());
    const hasSelectedTruck = selectedTruckId && selectedTruckId !== 'all';

    const selectedOpt =
      hasSelectedTruck && Array.isArray(optimizedRoutes) && optimizedRoutes.length
        ? optimizedRoutes.find((opt) => String(opt.truckId) === String(selectedTruckId))
        : null;

    if (selectedOpt && Array.isArray(selectedOpt.optimizedRoute)) {
      const routeCoords = selectedOpt.optimizedRoute
        .map(([lat, lng]) => ({ lat: parseCoord(lat), lng: parseCoord(lng) }))
        .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng));
      if (routeCoords.length >= 2) {
        const bounds = L.latLngBounds(
          routeCoords.map((pt) => L.latLng(pt.lat, pt.lng))
        );
        map.fitBounds(bounds, { padding: [30, 30] });
        return;
      }
    }

    if (showLiveTrucks && hasSelectedTruck) {
      const tr = safeTrucks.find((t) => String(t.truckId) === String(selectedTruckId));
      if (tr && Number.isFinite(tr.lat) && Number.isFinite(tr.lng)) {
        map.flyTo([tr.lat, tr.lng], targetZoom, { animate: true });
        return;
      }
    }

    if (mapView === 'municipality' && showLiveTrucks && selectedTruckId === 'all') {
      if (safeTrucks.length >= 2) {
        const bounds = L.latLngBounds(safeTrucks.map((t) => L.latLng(t.lat, t.lng)));
        map.fitBounds(bounds, { padding: [30, 30] });
        return;
      }
      if (safeTrucks.length === 1) {
        map.flyTo([safeTrucks[0].lat, safeTrucks[0].lng], targetZoom, { animate: true });
        return;
      }
    }

    if (mapView === 'municipality' && showRegisteredCities && safeCities.length >= 2) {
      const bounds = L.latLngBounds(
        safeCities.map((city) => L.latLng(city.lat, city.lng))
      );
      map.fitBounds(bounds, { padding: [30, 30] });
      return;
    }
    if (mapView === 'municipality' && showRegisteredCities && safeCities.length === 1) {
      const [city] = safeCities;
      map.flyTo([city.lat, city.lng], targetZoom, { animate: true });
      return;
    }

    if (baseCenter && Number.isFinite(baseCenter.lat) && Number.isFinite(baseCenter.lng)) {
      map.flyTo([baseCenter.lat, baseCenter.lng], targetZoom, { animate: true });
    }
  }, [
    selectedTruckId,
    trucksList,
    optimizedRoutes,
    mapView,
    mapZoom,
    baseCenter,
    showLiveTrucks,
    registeredCities,
    showRegisteredCities,
    safeTrucks,
    safeCities,
    map,
  ]);

  return null;
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();

  const [points, setPoints] = useState([]);
  const [aggregatePoints, setAggregatePoints] = useState([]);
  const [trucks, setTrucks] = useState({});
  const [allTruckIds, setAllTruckIds] = useState([]);
  const [truckStatusById, setTruckStatusById] = useState({});
  const [truckPaths, setTruckPaths] = useState({});
  const [summary, setSummary] = useState({ wasteKg: 0, co2Kg: 0, coKg: 0 });
  const [truckOptimizations, setTruckOptimizations] = useState([]);
  const [summaryError, setSummaryError] = useState('');
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const [optimized, setOptimized] = useState(false);
  const [hasOptimized, setHasOptimized] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const [animatedKpis, setAnimatedKpis] = useState({
    reducedDistanceKm: 0,
    reducedCo2Kg: 0,
    reducedCoKg: 0,
    timeSavedMinutes: 0,
    globalWarmingDeltaC: 0,
  });

  const socketRef = useRef(null);
  const optimizedRoutesRef = useRef(new Map());
  const optimizedRouteIndexRef = useRef(new Map());

  const [selectedTruck, setSelectedTruck] = useState('all');
  const selectedTruckRef = useRef('all');
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);
  const [chartType, setChartType] = useState('line');
  const [mapPrefs, setMapPrefs] = useState(DEFAULT_MAP_PREFS);
  const [municipalities, setMunicipalities] = useState([]);
  const [municipalityId, setMunicipalityId] = useState(null);

  const truckIcon = useMemo(() => buildTruckIcon(t('Truck icon')), [i18n.language, t]);
  const recyclingIcon = useMemo(() => buildRecyclingIcon(t('Recycling centre')), [i18n.language, t]);

  const emissionSeries = useMemo(
    () => [
      { key: 'wasteKg', name: t('Waste (kg)'), color: '#0ea5e9' },
      { key: 'co2Kg', name: t('CO2 (kg)'), color: '#f97316' },
      { key: 'coKg', name: t('CO (kg)'), color: '#22c55e' },
    ],
    [t]
  );

  const animationRef = useRef(null);
  const [liveKpis, setLiveKpis] = useState({
    reducedDistanceKm: 0,
    reducedCo2Kg: 0,
    reducedCoKg: 0,
    timeSavedMinutes: 0,
    globalWarmingDeltaC: 0,
    baselineDistanceKm: 0,
  });
  const safeMapPrefs = useMemo(() => sanitizeMapPrefs(mapPrefs), [mapPrefs]);
  const mapView = safeMapPrefs.map_view;
  const markerStyle = safeMapPrefs.marker_style;
  const mapZoom = safeMapPrefs.zoom;
  const showRegisteredCities = safeMapPrefs.show_registered_cities;
  const showRecyclingCenters = safeMapPrefs.show_recycling_centers;
  const showLiveTrucks = safeMapPrefs.show_trucks_live;

  const loadMapPreferences = useCallback(async () => {
    try {
      const { data } = await fetchGeneral();
      const effective = data?.effective || {};
      setMunicipalityId(data?.municipality_id ?? null);
      setMapPrefs(sanitizeMapPrefs(effective));
    } catch (err) {
      console.error('Map preferences load failed', err);
    }
  }, []);

  const loadMunicipalities = useCallback(async () => {
    try {
      const { data } = await fetchReportMunicipalities();
      if (Array.isArray(data?.data)) {
        setMunicipalities(data.data);
      } else if (Array.isArray(data)) {
        setMunicipalities(data);
      } else {
        setMunicipalities([]);
      }
    } catch (err) {
      console.error('Municipality list failed', err);
      setMunicipalities([]);
    }
  }, []);

  useEffect(() => {
    loadMapPreferences();
    loadMunicipalities();
  }, [loadMapPreferences, loadMunicipalities]);

  useEffect(() => {
    const refreshPrefs = () => {
      loadMapPreferences();
    };
    const refreshAll = () => {
      loadMapPreferences();
      loadMunicipalities();
    };
    const unsubUser = subscribeToSettings('userSettingsUpdated', refreshPrefs);
    const unsubMunicipality = subscribeToSettings('municipalitySettingsUpdated', refreshAll);
    return () => {
      unsubUser();
      unsubMunicipality();
    };
  }, [loadMapPreferences, loadMunicipalities]);

  useEffect(() => {
    selectedTruckRef.current = selectedTruck;
  }, [selectedTruck]);

  useEffect(() => {
    const nextRoutes = new Map();
    const nextIndexes = new Map();
    truckOptimizations.forEach((opt) => {
      const id = String(opt.truckId);
      if (Array.isArray(opt.optimizedRoute) && opt.optimizedRoute.length > 1) {
        nextRoutes.set(id, opt.optimizedRoute);
        const priorIndex = optimizedRouteIndexRef.current.get(id) ?? 0;
        nextIndexes.set(id, priorIndex);
      }
    });
    optimizedRoutesRef.current = nextRoutes;
    optimizedRouteIndexRef.current = nextIndexes;
  }, [truckOptimizations]);

  async function checkBackend() {
    try {
      await api.get('/health', { timeout: 4000 });
      setIsBackendOnline(true);
      setSummaryError('');
      return true;
    } catch {
      setIsBackendOnline(false);
      setSummaryError(t('Backend is unreachable. Start the server on port 5000 to see live data.'));
      return false;
    }
  }

  function aggregateOptimizations(rows, truckId) {
    if (!rows.length) return null;

    const filtered =
      truckId === 'all'
        ? rows
        : rows.filter((row) => String(row.truckId) === String(truckId));

    if (!filtered.length) return null;

    const totals = filtered.reduce(
      (acc, row) => {
        const toN = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        acc.reducedDistanceKm += toN(row.reducedDistanceKm);
        acc.reducedCo2Kg += toN(row.reducedCo2Kg);
        acc.reducedCoKg += toN(row.reducedCoKg);
        acc.timeSavedMinutes += toN(row.timeSavedMinutes);
        acc.globalWarmingDeltaC += toN(row.globalWarmingDeltaC);
        acc.baselineDistanceKm += toN(row.baselineDistanceKm);
        acc.optimizedDistanceKm += toN(row.optimizedDistanceKm);
        return acc;
      },
      {
        reducedDistanceKm: 0,
        reducedCo2Kg: 0,
        reducedCoKg: 0,
        timeSavedMinutes: 0,
        globalWarmingDeltaC: 0,
        baselineDistanceKm: 0,
        optimizedDistanceKm: 0,
      }
    );

    const efficiencyGain =
      totals.baselineDistanceKm > 0
        ? Number(((totals.reducedDistanceKm / totals.baselineDistanceKm) * 100).toFixed(1))
        : 0;

    return { ...totals, efficiencyGain };
  }

  const loadSummary = useCallback(async (truckIdOverride) => {
    setSummaryError('');
    try {
      const truckId = truckIdOverride ?? selectedTruck;
      const res = await api.get('/dashboard/summary', {
        params: {
          truckId,
          includeOptimizations: hasOptimized ? 1 : 0,
        },
      });

      const totals = res.data?.totals || {};
      const nextSummary = {
        wasteKg: res.data?.wasteKg ?? 0,
        co2Kg: res.data?.co2Kg ?? 0,
        coKg: res.data?.coKg ?? 0,
        efficiencyGain: totals.efficiencyGain ?? res.data?.efficiencyGain ?? 0,
        reducedDistanceKm: totals.reducedDistanceKm ?? res.data?.reducedDistanceKm ?? 0,
        reducedCo2Kg: totals.reducedCo2Kg ?? res.data?.reducedCo2Kg ?? 0,
        reducedCoKg: totals.reducedCoKg ?? res.data?.reducedCoKg ?? 0,
        timeSavedMinutes: totals.timeSavedMinutes ?? res.data?.timeSavedMinutes ?? 0,
        globalWarmingDeltaC: Number(totals.globalWarmingDeltaC ?? res.data?.globalWarmingDeltaC ?? 0),
        baselineDistanceKm: Number(totals.baselineDistanceKm ?? res.data?.baselineDistanceKm ?? 0),
      };

      setSummary(nextSummary);
      setLiveKpis({
        reducedDistanceKm: nextSummary.reducedDistanceKm ?? 0,
        reducedCo2Kg: nextSummary.reducedCo2Kg ?? 0,
        reducedCoKg: nextSummary.reducedCoKg ?? 0,
        timeSavedMinutes: nextSummary.timeSavedMinutes ?? 0,
        globalWarmingDeltaC: nextSummary.globalWarmingDeltaC ?? 0,
        baselineDistanceKm: nextSummary.baselineDistanceKm ?? 0,
      });

      // ✅ CRITICAL FIX: do NOT overwrite optimizations with [] if API doesn't send them
      if (Array.isArray(res.data?.truckOptimizations)) {
        setTruckOptimizations(res.data.truckOptimizations);
      }

      // if backend sends totals with reductions, keep optimized badge correct
      setOptimized(Boolean(nextSummary.reducedDistanceKm));
    } catch (err) {
      const msg = t(err?.response?.data?.message || 'Unable to load dashboard summary.');
      setSummaryError(msg);
      if (err?.code === 'ERR_NETWORK') setIsBackendOnline(false);
      console.warn(err);
    }
  }, [selectedTruck, hasOptimized, t]);

  const loadAllTrucks = useCallback(async () => {
    try {
      const res = await api.get('/trucks');
      const list = Array.isArray(res.data) ? res.data : res.data?.data;
      if (Array.isArray(list)) {
        const nextStatusMap = {};
        const activeIds = [];

        list.forEach((truck) => {
          const id = String(truck.id);
          const status = normalizeStatus(truck.status);
          nextStatusMap[id] = status || 'active';
          if (!isHiddenStatus(status)) {
            activeIds.push(id);
          }
        });

        activeIds.sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        );
        setTruckStatusById(nextStatusMap);
        setAllTruckIds(activeIds);
        return;
      }
      setTruckStatusById({});
      setAllTruckIds([]);
    } catch (err) {
      console.warn('Failed to load trucks:', err);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const healthy = await checkBackend();
      if (!healthy || !active) return;

      await loadSummary(selectedTruck);
      await loadAllTrucks();

      // Load initial truck positions from DB so the map renders
      // immediately without waiting for socket telemetry events.
      try {
        const liveRes = await api.get('/dashboard/live-trucks');
        const liveTrucks = liveRes.data?.trucks;
        if (Array.isArray(liveTrucks) && liveTrucks.length > 0) {
          const initialTrucks = {};
          const initialPoints = [];
          liveTrucks.forEach((tr) => {
            if (!tr.truckId || !Number.isFinite(tr.lat) || !Number.isFinite(tr.lng)) return;
            initialTrucks[tr.truckId] = {
              truckId: String(tr.truckId),
              lat: tr.lat,
              lng: tr.lng,
              speedKmh: tr.speedKmh || 0,
              wasteKg: tr.wasteKg || 0,
              co2Kg: tr.co2Kg || 0,
              coKg: tr.coKg || 0,
              type: tr.type || tr.truckCode || `Truck ${tr.truckId}`,
              timestamp: tr.timestamp || new Date().toISOString(),
            };
            initialPoints.push({
              time: new Date(tr.timestamp || Date.now()).toLocaleTimeString(),
              timestamp: tr.timestamp || new Date().toISOString(),
              truckId: String(tr.truckId),
              type: tr.type || tr.truckCode || `Truck ${tr.truckId}`,
              lat: tr.lat,
              lng: tr.lng,
              wasteKg: tr.wasteKg || 0,
              co2Kg: tr.co2Kg || 0,
              coKg: tr.coKg || 0,
            });
          });
          if (active) {
            setTrucks(initialTrucks);
            setPoints(initialPoints);
            setAggregatePoints(initialPoints.slice(-100));
          }
        }
      } catch (err) {
        console.warn('Failed to load initial truck positions:', err);
      }

      const socketInstance = getSettingsSocket();

      socketRef.current = socketInstance;

      const handleTelemetry = (data) => {
        const parsedTs = data.timestamp ? new Date(data.timestamp) : new Date();
        const ts = parsedTs.toString() === 'Invalid Date' ? new Date() : parsedTs;

        const truckId = data.truckId ?? data.truck_id;
        const lat = toNum(data.lat ?? data.latitude);
        const lng = toNum(data.lng ?? data.longitude ?? data.long);

        if (!truckId) return;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        let displayLat = lat;
        let displayLng = lng;
        const selectedId = selectedTruckRef.current || 'all';
        const routeKey = String(truckId);
        const optimizedRoute = optimizedRoutesRef.current.get(routeKey);
        const allowOptimized =
          selectedId === 'all' || String(selectedId) === routeKey;

        if (allowOptimized && Array.isArray(optimizedRoute) && optimizedRoute.length > 1) {
          const nextIndex = optimizedRouteIndexRef.current.get(routeKey) ?? 0;
          const nextPoint = optimizedRoute[nextIndex % optimizedRoute.length];
          if (Array.isArray(nextPoint) && nextPoint.length >= 2) {
            const [optLat, optLng] = nextPoint;
            if (Number.isFinite(optLat) && Number.isFinite(optLng)) {
              displayLat = optLat;
              displayLng = optLng;
              optimizedRouteIndexRef.current.set(routeKey, nextIndex + 1);
            }
          }
        }

        const telemetry = {
          truckId: String(truckId),
          lat: displayLat,
          lng: displayLng,
          speedKmh: Number(data.speedKmh || data.speed_kmh || 0),
          wasteKg: Number(data.wasteKg || data.waste_kg || 0),
          co2Kg: Number(data.co2Kg || data.co2_kg || 0),
          coKg: Number(data.coKg || data.co_kg || 0),
          type: data.type || data.truckType || data.category || 'Unknown',
          timestamp: ts.toISOString(),
        };

        setPoints((prev) =>
          [
            ...prev,
            {
              time: ts.toLocaleTimeString(),
              timestamp: telemetry.timestamp,
              truckId: telemetry.truckId,
              type: telemetry.type,
              lat: telemetry.lat,
              lng: telemetry.lng,
              wasteKg: telemetry.wasteKg,
              co2Kg: telemetry.co2Kg,
              coKg: telemetry.coKg,
            },
          ].slice(-100)
        );

        setTruckPaths((prev) => {
          const key = telemetry.truckId;
          const newPath = prev[key] ? [...prev[key]] : [];
          newPath.push([telemetry.lat, telemetry.lng]);
          return { ...prev, [key]: newPath.slice(-50) };
        });

        setTrucks((prev) => {
          const next = { ...prev, [telemetry.truckId]: telemetry };
          // Calculate current fleet aggregate for the chart
          const truckList = Object.values(next);
          const fleetPoint = {
            time: ts.toLocaleTimeString(),
            timestamp: telemetry.timestamp,
            truckId: 'fleet',
            wasteKg: Number(truckList.reduce((s, t) => s + (t.wasteKg || 0), 0).toFixed(2)),
            co2Kg: Number(truckList.reduce((s, t) => s + (t.co2Kg || 0), 0).toFixed(2)),
            coKg: Number(truckList.reduce((s, t) => s + (t.coKg || 0), 0).toFixed(2)),
          };
          setAggregatePoints((prevAgg) => {
            const last = prevAgg[prevAgg.length - 1];
            if (last && last.time === fleetPoint.time) {
              // Same time tick, update the last point instead of appending
              const nextAgg = [...prevAgg];
              nextAgg[nextAgg.length - 1] = fleetPoint;
              return nextAgg;
            }
            return [...prevAgg, fleetPoint].slice(-100);
          });
          return next;
        });
      };

      const handleRouteOptimized = (payload) => {
        if (!payload) return;
        setHasOptimized(true);

        const nextOptimizations = Array.isArray(payload.truckOptimizations)
          ? payload.truckOptimizations
          : [];

        if (nextOptimizations.length) setTruckOptimizations(nextOptimizations);

        const selection = selectedTruckRef.current || 'all';
        const selectionTotals = aggregateOptimizations(nextOptimizations, selection);
        const totalsForView = selectionTotals || (selection === 'all' ? payload.totals : null);

        if (totalsForView) {
          setSummary((prev) => ({
            ...(prev || {}),
            efficiencyGain: totalsForView.efficiencyGain ?? prev?.efficiencyGain ?? 0,
            reducedDistanceKm: totalsForView.reducedDistanceKm ?? prev?.reducedDistanceKm ?? 0,
            reducedCo2Kg: totalsForView.reducedCo2Kg ?? prev?.reducedCo2Kg ?? 0,
            reducedCoKg: totalsForView.reducedCoKg ?? prev?.reducedCoKg ?? 0,
            timeSavedMinutes: totalsForView.timeSavedMinutes ?? prev?.timeSavedMinutes ?? 0,
            globalWarmingDeltaC: totalsForView.globalWarmingDeltaC ?? prev?.globalWarmingDeltaC ?? 0,
            baselineDistanceKm: totalsForView.baselineDistanceKm ?? prev?.baselineDistanceKm ?? 0,
          }));

          setLiveKpis({
            reducedDistanceKm: totalsForView.reducedDistanceKm ?? 0,
            reducedCo2Kg: totalsForView.reducedCo2Kg ?? 0,
            reducedCoKg: totalsForView.reducedCoKg ?? 0,
            timeSavedMinutes: totalsForView.timeSavedMinutes ?? 0,
            globalWarmingDeltaC: totalsForView.globalWarmingDeltaC ?? 0,
            baselineDistanceKm: totalsForView.baselineDistanceKm ?? 0,
          });

          setOptimized(Boolean(totalsForView.reducedDistanceKm));
        }
      };

      socketInstance.on('telemetry:update', handleTelemetry);
      socketInstance.on('route:optimized', handleRouteOptimized);
      socketInstance.on('connect', () => active && setIsBackendOnline(true));
      socketInstance.on('connect_error', () => active && setIsBackendOnline(false));
    }

    bootstrap();

    return () => {
      active = false;
      if (socketRef.current) {
        socketRef.current.off('telemetry:update');
        socketRef.current.off('route:optimized');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [loadAllTrucks]);

  useEffect(() => {
    if (!isBackendOnline) return;
    const interval = setInterval(() => {
      loadAllTrucks();
    }, 30000);
    return () => clearInterval(interval);
  }, [isBackendOnline, loadAllTrucks]);

  async function handleOptimize() {
    if (!isBackendOnline) {
      setSummaryError(t('Backend is offline. Start the server before optimizing routes.'));
      return;
    }

    try {
      setIsOptimizing(true);

      const { data: opt } = await api.post('/dashboard/optimize-routes', {
        truckId: 'all',
      });
      setHasOptimized(true);

      const nextOptimizations = Array.isArray(opt?.truckOptimizations) ? opt.truckOptimizations : [];
      if (nextOptimizations.length) setTruckOptimizations(nextOptimizations);

      const selectionTotals = aggregateOptimizations(nextOptimizations, selectedTruck);
      const totalsForView = selectionTotals || opt?.totals || null;

      if (totalsForView) {
        setSummary((prev) => ({
          ...(prev || {}),
          efficiencyGain: totalsForView.efficiencyGain ?? prev?.efficiencyGain ?? 0,
          reducedDistanceKm: totalsForView.reducedDistanceKm ?? prev?.reducedDistanceKm ?? 0,
          reducedCo2Kg: totalsForView.reducedCo2Kg ?? prev?.reducedCo2Kg ?? 0,
          reducedCoKg: totalsForView.reducedCoKg ?? prev?.reducedCoKg ?? 0,
          timeSavedMinutes: totalsForView.timeSavedMinutes ?? prev?.timeSavedMinutes ?? 0,
          globalWarmingDeltaC: Number(totalsForView.globalWarmingDeltaC ?? prev?.globalWarmingDeltaC ?? 0),
          baselineDistanceKm: Number(totalsForView.baselineDistanceKm ?? prev?.baselineDistanceKm ?? 0),
        }));

        setLiveKpis({
          reducedDistanceKm: totalsForView.reducedDistanceKm ?? 0,
          reducedCo2Kg: totalsForView.reducedCo2Kg ?? 0,
          reducedCoKg: totalsForView.reducedCoKg ?? 0,
          timeSavedMinutes: totalsForView.timeSavedMinutes ?? 0,
          globalWarmingDeltaC: totalsForView.globalWarmingDeltaC ?? 0,
          baselineDistanceKm: totalsForView.baselineDistanceKm ?? 0,
        });

        setOptimized(Boolean(totalsForView.reducedDistanceKm));
      }

      // ✅ CRITICAL FIX: DO NOT immediately reload summary (it wipes optimizations if API omits them)
      // If you still want to refresh other metrics, ensure /dashboard/summary returns truckOptimizations,
      // or call a "summary" endpoint that does NOT touch truckOptimizations state.
      // await loadSummary(selectedTruck);

    } catch (err) {
      console.error(err);
    } finally {
      setIsOptimizing(false);
    }
  }

  const handleClearOptimization = useCallback(() => {
    setHasOptimized(false);
    setTruckOptimizations([]);
    setLiveKpis({
      reducedDistanceKm: 0,
      reducedCo2Kg: 0,
      reducedCoKg: 0,
      timeSavedMinutes: 0,
      globalWarmingDeltaC: 0,
      baselineDistanceKm: 0,
    });
  }, []);

  const handleStopOptimization = useCallback(async () => {
    // Reset local state immediately for a responsive UI
    setIsOptimizing(false);
    setHasOptimized(false);
    setTruckOptimizations([]);

    try {
      // Notify backend to stop the live optimization stream
      await api.post(`/dashboard/stop-optimization`, { truckId: selectedTruck });
    } catch (err) {
      console.error('Stop optimization failed', err);
    }
  }, [selectedTruck]);

  function openDownloadDialog() {
    setIsDownloadOpen(true);
  }
  function closeDownloadDialog() {
    setIsDownloadOpen(false);
  }

  const truckArray = useMemo(() => Object.values(trucks), [trucks]);

  const filteredTruckArray =
    selectedTruck === 'all'
      ? truckArray
      : truckArray.filter((tr) => String(tr.truckId) === String(selectedTruck));

  const filteredPoints =
    selectedTruck === 'all'
      ? points
      : points.filter((p) => String(p.truckId) === String(selectedTruck));

  const hiddenTruckIds = useMemo(() => {
    const hidden = new Set();
    Object.entries(truckStatusById).forEach(([id, status]) => {
      if (isHiddenStatus(status)) hidden.add(String(id));
    });
    return hidden;
  }, [truckStatusById]);

  const activeTruckArray = useMemo(
    () =>
      filteredTruckArray.filter(
        (tr) => !hiddenTruckIds.has(String(tr.truckId ?? tr.id))
      ),
    [filteredTruckArray, hiddenTruckIds]
  );

  const visiblePoints = useMemo(() => {
    if (selectedTruck === 'all') return aggregatePoints;
    return filteredPoints.filter((p) => !hiddenTruckIds.has(String(p.truckId)));
  }, [selectedTruck, aggregatePoints, filteredPoints, hiddenTruckIds]);

  const visibleOptimizations = useMemo(() => {
    const base =
      selectedTruck === 'all'
        ? truckOptimizations
        : truckOptimizations.filter((opt) => String(opt.truckId) === String(selectedTruck));
    return base.filter((opt) => !hiddenTruckIds.has(String(opt.truckId)));
  }, [truckOptimizations, selectedTruck, hiddenTruckIds]);

  const normalizedTrucks = useMemo(() => {
    return activeTruckArray
      .map((tr) => ({ ...tr, lat: parseCoord(tr.lat), lng: parseCoord(tr.lng) }))
      .filter((tr) => Number.isFinite(tr.lat) && Number.isFinite(tr.lng))
      .sort((a, b) => Number(a.truckId) - Number(b.truckId));
  }, [activeTruckArray]);

  const truckIds = useMemo(() => {
    const ids =
      allTruckIds.length > 0
        ? allTruckIds.filter((id) => !hiddenTruckIds.has(String(id)))
        : Object.keys(trucks)
          .filter((id) => !hiddenTruckIds.has(String(id)))
          .map(String)
          .sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
          );
    return ids;
  }, [allTruckIds, trucks, hiddenTruckIds]);

  useEffect(() => {
    if (selectedTruck !== 'all' && !truckIds.includes(selectedTruck)) {
      setSelectedTruck('all');
    }
  }, [truckIds, selectedTruck]);

  useEffect(() => {
    if (!isBackendOnline) return;
    loadSummary(selectedTruck);
  }, [selectedTruck, isBackendOnline, hasOptimized, loadSummary]);

  // ✅ Animate KPI numbers whenever liveKpis changes
  useEffect(() => {
    if (!liveKpis) return;

    const start = { ...animatedKpis };
    const target = {
      reducedDistanceKm: Number(liveKpis.reducedDistanceKm ?? 0),
      reducedCo2Kg: Number(liveKpis.reducedCo2Kg ?? 0),
      reducedCoKg: Number(liveKpis.reducedCoKg ?? 0),
      timeSavedMinutes: Number(liveKpis.timeSavedMinutes ?? 0),
      globalWarmingDeltaC: Number(liveKpis.globalWarmingDeltaC ?? 0),
    };

    const duration = 800;
    const startTs = performance.now();
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const step = (now) => {
      const tt = Math.min(1, (now - startTs) / duration);
      const ease = 1 - Math.pow(1 - tt, 3);

      setAnimatedKpis({
        reducedDistanceKm: start.reducedDistanceKm + (target.reducedDistanceKm - start.reducedDistanceKm) * ease,
        reducedCo2Kg: start.reducedCo2Kg + (target.reducedCo2Kg - start.reducedCo2Kg) * ease,
        reducedCoKg: start.reducedCoKg + (target.reducedCoKg - start.reducedCoKg) * ease,
        timeSavedMinutes: start.timeSavedMinutes + (target.timeSavedMinutes - start.timeSavedMinutes) * ease,
        globalWarmingDeltaC: start.globalWarmingDeltaC + (target.globalWarmingDeltaC - start.globalWarmingDeltaC) * ease,
      });

      if (tt < 1) animationRef.current = requestAnimationFrame(step);
    };

    animationRef.current = requestAnimationFrame(step);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [liveKpis, animatedKpis.reducedDistanceKm, animatedKpis.reducedCo2Kg, animatedKpis.reducedCoKg, animatedKpis.timeSavedMinutes, animatedKpis.globalWarmingDeltaC]);

  const currentMunicipality = useMemo(() => {
    if (!municipalityId || !municipalities.length) return null;
    return municipalities.find((m) => String(m.id) === String(municipalityId)) || null;
  }, [municipalityId, municipalities]);

  const municipalityCenter = useMemo(() => {
    if (!currentMunicipality) return null;
    const lat = parseCoord(currentMunicipality.address_lat);
    const lng = parseCoord(currentMunicipality.address_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [currentMunicipality]);

  const registeredCities = useMemo(() => {
    if (!showRegisteredCities) return [];
    const currentId = municipalityId ? String(municipalityId) : null;
    return municipalities
      .map((municipality) => {
        const lat = parseCoord(municipality.address_lat);
        const lng = parseCoord(municipality.address_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          id: municipality.id,
          label: resolveMunicipalityLabel(municipality),
          lat,
          lng,
          municipality,
        };
      })
      .filter(Boolean)
      .filter(
        (city) =>
          !(showRecyclingCenters && currentId && String(city.id) === currentId)
      );
  }, [municipalities, municipalityId, showRegisteredCities, showRecyclingCenters]);

  const recyclingCenter = useMemo(() => {
    if (!municipalityCenter) return null;
    return {
      lat: municipalityCenter.lat,
      lng: municipalityCenter.lng,
      label: resolveMunicipalityLabel(currentMunicipality),
    };
  }, [municipalityCenter, currentMunicipality]);

  const mapTrucks = useMemo(
    () => (showLiveTrucks ? normalizedTrucks : EMPTY_ARRAY),
    [showLiveTrucks, normalizedTrucks]
  );

  const baseCenter = useMemo(() => {
    if (municipalityCenter) return municipalityCenter;
    if (mapTrucks.length > 0) {
      return { lat: mapTrucks[0].lat, lng: mapTrucks[0].lng };
    }
    if (registeredCities.length > 0) {
      return { lat: registeredCities[0].lat, lng: registeredCities[0].lng };
    }
    return DEFAULT_MAP_CENTER;
  }, [municipalityCenter, mapTrucks, registeredCities]);

  const mapCenter = useMemo(() => [baseCenter.lat, baseCenter.lng], [baseCenter]);

  const truckLabelIcons = useMemo(() => {
    if (markerStyle !== 'labels' || !showLiveTrucks) return new Map();
    const map = new Map();
    normalizedTrucks.forEach((tr) => {
      const label = t('Truck {{id}}', { id: tr.truckId });
      map.set(String(tr.truckId), buildLabelIcon(label, 'truck'));
    });
    return map;
  }, [markerStyle, showLiveTrucks, normalizedTrucks, t, i18n.language]);

  const cityLabelIcons = useMemo(() => {
    if (markerStyle !== 'labels') return new Map();
    const map = new Map();
    registeredCities.forEach((city) => {
      map.set(String(city.id), buildLabelIcon(city.label, 'city'));
    });
    return map;
  }, [markerStyle, registeredCities]);

  const recyclingLabelIcon = useMemo(() => {
    if (markerStyle !== 'labels') return null;
    return buildLabelIcon(t('Recycling centre'), 'center');
  }, [markerStyle, t, i18n.language]);

  const lastPoint = visiblePoints.length ? visiblePoints[visiblePoints.length - 1] : null;

  // KPI cards show the sum of the latest values of all currently active/visible trucks.
  // This provides a "live fleet status" rather than an all-time historical total.
  const kpiWaste = Number(activeTruckArray.reduce((sum, tr) => sum + (Number(tr?.wasteKg) || 0), 0).toFixed(2));
  const kpiCo2 = Number(activeTruckArray.reduce((sum, tr) => sum + (Number(tr?.co2Kg) || 0), 0).toFixed(2));
  const kpiCo = Number(activeTruckArray.reduce((sum, tr) => sum + (Number(tr?.coKg) || 0), 0).toFixed(2));

  // ✅ FIX: use animated KPI warming value, not summary
  const warmingDelta = animatedKpis.globalWarmingDeltaC ?? 0;

  const chartMargin = { top: 12, right: 18, left: 0, bottom: 8 };

  function renderChart() {
    const renderAxes = () => [
      <CartesianGrid key="grid" strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />,
      <XAxis
        key="x"
        dataKey="time"
        tick={{ fontSize: 11, fill: '#64748b' }}
        tickLine={false}
        axisLine={{ stroke: '#cbd5e1' }}
        minTickGap={20}
      />,
      <YAxis
        key="yl"
        yAxisId="left"
        tick={{ fontSize: 11, fill: '#64748b' }}
        domain={['auto', 'auto']}
        tickLine={false}
        axisLine={{ stroke: '#cbd5e1' }}
        tickFormatter={(v) => Number(v).toFixed(0)}
        label={{ value: t('Emissions (kg)'), angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 10 } }}
      />,
      <YAxis
        key="yr"
        yAxisId="right"
        orientation="right"
        tick={{ fontSize: 11, fill: '#64748b' }}
        domain={['auto', 'auto']}
        tickLine={false}
        axisLine={{ stroke: '#cbd5e1' }}
        tickFormatter={(v) => Number(v).toFixed(1)}
        label={{ value: t('Waste (kg)'), angle: 90, position: 'insideRight', style: { fill: '#64748b', fontSize: 10 } }}
      />,
      <Tooltip
        key="tooltip"
        cursor={{ stroke: '#0ea5e9', strokeWidth: 1 }}
        contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
      />,
      <Legend key="legend" verticalAlign="top" height={32} iconType="circle" />
    ];

    if (chartType === 'area') {
      return (
        <AreaChart data={visiblePoints} margin={chartMargin}>
          {renderAxes()}
          {emissionSeries.map((series) => (
            <Area
              key={series.key}
              yAxisId={series.key === 'wasteKg' ? 'right' : 'left'}
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stroke={series.color}
              fill={series.color}
              strokeWidth={2}
              fillOpacity={0.2}
              activeDot={{ r: 6 }}
              dot={false}
            />
          ))}
        </AreaChart>
      );
    }

    if (chartType === 'stacked') {
      return (
        <BarChart data={visiblePoints} margin={chartMargin}>
          {renderAxes()}
          {emissionSeries.map((series) => (
            <Bar
              key={series.key}
              yAxisId={series.key === 'wasteKg' ? 'right' : 'left'}
              dataKey={series.key}
              name={series.name}
              fill={series.color}
              stackId={series.key === 'wasteKg' ? 'waste' : 'emissions'}
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
            />
          ))}
        </BarChart>
      );
    }

    return (
      <LineChart data={visiblePoints} margin={chartMargin}>
        {renderAxes()}
        {emissionSeries.map((series) => (
          <Line
            key={series.key}
            yAxisId={series.key === 'wasteKg' ? 'right' : 'left'}
            type="monotone"
            dataKey={series.key}
            name={series.name}
            stroke={series.color}
            strokeWidth={2.5}
            activeDot={{ r: 6 }}
            dot={false}
          />
        ))}
      </LineChart>
    );
  }

  const trailsByTruck = useMemo(() => {
    if (!showLiveTrucks) return new Map();
    const grouped = new Map();
    for (const p of visiblePoints) {
      if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue;
      const id = String(p.truckId);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push([Number(p.lat), Number(p.lng)]);
    }
    for (const [id, coords] of grouped.entries()) grouped.set(id, coords.slice(-80));
    return grouped;
  }, [visiblePoints, showLiveTrucks]);

  return (
    <div className="dashboard-container">
      <div className="filter-row">
        <div className="dashboard-title">{t('Live dashboard')}</div>

        <div className="top-right-controls">
          <div className="truck-filter-wrapper">
            <label htmlFor="truckFilter">{t('Truck:')}</label>
            <select
              id="truckFilter"
              className="truck-filter"
              value={selectedTruck}
              onChange={(e) => setSelectedTruck(e.target.value)}
            >
              <option value="all">{t('All')}</option>
              {truckIds.map((id) => (
                <option key={id} value={id}>
                  {t('Truck {{id}}', { id })}
                </option>
              ))}
            </select>
          </div>

          <button className="download-open-btn" onClick={openDownloadDialog}>
            {t('Download')}
          </button>
        </div>
      </div>

      {!isBackendOnline && (
        <div className="offline-banner">
          {t('Backend is offline. Start the API server at {{url}} to restore live data.', {
            url: API_BASE_URL,
          })}
        </div>
      )}
      {summaryError && isBackendOnline && (
        <div className="offline-banner offline-banner--warn">{summaryError}</div>
      )}

      <div className="top-section">
        <div className="panel map-panel">
          <div className="map-title">{t('Live truck tracking')}</div>

          <MapContainer center={mapCenter} zoom={mapZoom} className="map" style={{ height: 420, width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            <MapAutoCenter
              selectedTruckId={selectedTruck}
              trucksList={mapTrucks}
              optimizedRoutes={visibleOptimizations}
              mapView={mapView}
              mapZoom={mapZoom}
              baseCenter={baseCenter}
              showLiveTrucks={showLiveTrucks}
              registeredCities={registeredCities}
              showRegisteredCities={showRegisteredCities}
            />

            {showRecyclingCenters && recyclingCenter && (
              <Marker
                position={[recyclingCenter.lat, recyclingCenter.lng]}
                icon={markerStyle === 'labels' ? recyclingLabelIcon : recyclingIcon}
              >
                <Popup>
                  <strong>{t('Recycling centre')}</strong>
                  {recyclingCenter.label && (
                    <>
                      <br />
                      {recyclingCenter.label}
                    </>
                  )}
                </Popup>
              </Marker>
            )}

            {showRegisteredCities &&
              registeredCities.map((city) => {
                const cityIcon =
                  markerStyle === 'labels' ? cityLabelIcons.get(String(city.id)) : null;
                return (
                  <Marker
                    key={`city-${city.id}`}
                    position={[city.lat, city.lng]}
                    {...(cityIcon ? { icon: cityIcon } : {})}
                  >
                    <Popup>
                      <strong>{city.label}</strong>
                      {(city.municipality.city ||
                        city.municipality.state_region ||
                        city.municipality.municipality_code) && (
                          <>
                            <br />
                            {city.municipality.city ||
                              city.municipality.state_region ||
                              city.municipality.municipality_code}
                          </>
                        )}
                    </Popup>
                  </Marker>
                );
              })}

            {showLiveTrucks &&
              Array.from(trailsByTruck.entries()).map(([truckId, coords]) => {
                if (!coords || coords.length < 2) return null;
                const color = trailColorFor(truckId);
                const dimmed = selectedTruck !== 'all' && String(selectedTruck) !== String(truckId);

                return (
                  <Polyline
                    key={`trail-${truckId}`}
                    positions={coords}
                    pathOptions={{ color, weight: dimmed ? 3 : 5, opacity: dimmed ? 0.35 : 0.85 }}
                  />
                );
              })}

            {visibleOptimizations.map((opt) => (
              <Fragment key={`opt-layer-${opt.truckId}-${opt.id || 'latest'}`}>
                {Array.isArray(opt?.baselineRoute) && opt.baselineRoute.length > 1 && (
                  <Polyline
                    key={`baseline-${opt.truckId}-${opt.id || 'latest'}`}
                    positions={opt.baselineRoute.map(([lat, lng]) => [lat, lng])}
                    pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.7, dashArray: '6 10' }}
                  />
                )}
                {Array.isArray(opt?.optimizedRoute) && opt.optimizedRoute.length > 1 && (
                  <Polyline
                    key={`optimized-${opt.truckId}-${opt.id || 'latest'}`}
                    positions={opt.optimizedRoute.map(([lat, lng]) => [lat, lng])}
                    pathOptions={{ color: '#22c55e', weight: 5, opacity: 0.9 }}
                  />
                )}
              </Fragment>
            ))}

            {showLiveTrucks &&
              activeTruckArray.map((tr) => {
                const path = truckPaths[String(tr.truckId)];
                if (!path || path.length < 2) return null;
                const truckColor = colorPalette[hashString(String(tr.truckId)) % colorPalette.length];
                return (
                  <Polyline
                    key={`live-path-${tr.truckId}`}
                    positions={path}
                    pathOptions={{ color: truckColor, weight: 3, opacity: 0.6 }}
                  />
                );
              })}

            {showLiveTrucks &&
              normalizedTrucks.map((tr) => {
                const labelIcon = truckLabelIcons.get(String(tr.truckId));
                const icon = markerStyle === 'labels' ? labelIcon || truckIcon : truckIcon;
                return (
                  <Marker key={`truck-${tr.truckId}`} position={[tr.lat, tr.lng]} icon={icon}>
                    <Popup>
                      {t('Truck {{id}}', { id: tr.truckId })}
                      <br />
                      {t('Speed: {{value}} km/h', { value: tr.speedKmh ?? '-' })}
                      <br />
                      {t('Waste: {{value}} kg', { value: tr.wasteKg ?? '-' })}
                    </Popup>
                  </Marker>
                );
              })}
          </MapContainer>
        </div>

        <div className="right-column">
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">{t('Waste load')}</div>
              <div className="kpi-value">
                {kpiWaste} <span>{t('kg')}</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t('CO₂ Emission')}</div>
              <div className="kpi-value">
                {kpiCo2} <span>{t('kg')}</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{t('CO Emission')}</div>
              <div className="kpi-value">
                {kpiCo} <span>{t('kg')}</span>
              </div>
            </div>
          </div>

          <div className="panel chart-panel">
            <div className="chart-header">
              <div className="chart-title">{t('Live emissions & waste chart')}</div>
              <label className="chart-type-control">
                <span className="chart-type-label">{t('Type')}</span>
                <select className="chart-type-select" value={chartType} onChange={(e) => setChartType(e.target.value)}>
                  <option value="line">{t('Line chart')}</option>
                  <option value="area">{t('Area chart')}</option>
                  <option value="stacked">{t('Stacked bar chart')}</option>
                </select>
              </label>
            </div>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={260}>
                {renderChart()}
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="bottom-row">
        <div className="panel">
          <div className="optimization-header">
            <h3>{t('AI route optimization')}</h3>
            {optimized && (
              <span className="opt-badge opt-badge--success">
                <span className="opt-badge-dot" aria-hidden="true" />
                {t('Optimized')}
              </span>
            )}
          </div>

          <div className="optimization-actions">
            <button className="btn-primary" onClick={handleOptimize} disabled={isOptimizing}>
              {isOptimizing ? t('Optimizing...') : t('Optimize routes')}
            </button>
            {isOptimizing && (
              <button className="btn-secondary" onClick={handleStopOptimization} style={{ marginLeft: '12px' }}>
                {t('Stop')}
              </button>
            )}
            {!isOptimizing && hasOptimized && (
              <button className="btn-secondary" onClick={handleStopOptimization} style={{ marginLeft: '12px' }}>
                {t('Stop Optimization')}
              </button>
            )}
            <span className="optimization-hint">{t('Runs AI to shorten routes and lower emissions.')}</span>
          </div>

          <div className="optimization-cards">
            <div className="opt-card">
              <div className="opt-card-label">{t('Reduced distance:')}</div>
              <div className="opt-card-value">
                {formatReduction(animatedKpis.reducedDistanceKm, 3)} <span className="opt-card-unit">{t('km')}</span>
              </div>
            </div>
            <div className="opt-card">
              <div className="opt-card-label">{t('Reduced CO₂:')}</div>
              <div className="opt-card-value">
                {formatReduction(animatedKpis.reducedCo2Kg, 3)} <span className="opt-card-unit">{t('kg')}</span>
              </div>
            </div>
            <div className="opt-card">
              <div className="opt-card-label">{t('Reduced CO:')}</div>
              <div className="opt-card-value">
                {formatReduction(animatedKpis.reducedCoKg, 3)} <span className="opt-card-unit">{t('kg')}</span>
              </div>
            </div>
            <div className="opt-card">
              <div className="opt-card-label">{t('Time saved:')}</div>
              <div className="opt-card-value">
                {formatReduction(animatedKpis.timeSavedMinutes, 1)} <span className="opt-card-unit">{t('min')}</span>
              </div>
            </div>
            <div className={`opt-card ${warmingDelta < 0 ? 'opt-card--good' : warmingDelta > 0 ? 'opt-card--warn' : ''}`}>
              <div className="opt-card-label">{t('Global warming:')}</div>
              <div className="opt-card-value">
                {warmingDelta > 0 ? t('Rising') : warmingDelta < 0 ? t('Falling') : t('Stable')}{' '}
                {formatWarming(animatedKpis.globalWarmingDeltaC)} <span className="opt-card-unit">{t('℃')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isDownloadOpen && (
        <ExportDialog
          isOpen={isDownloadOpen}
          onClose={closeDownloadDialog}
          truckIds={truckIds}
          defaultTruckId={selectedTruck}
          companyName={t('Smart Waste System')}
        />
      )}
    </div>
  );
}
