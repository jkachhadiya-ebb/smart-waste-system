const pool = require('../db');
const { calcCo2FromFuel, calcCoFromCo2, carbonFootprintKg } = require('./emissions');

const DEFAULT_LOOKBACK_MINUTES = 10; // Focus on very recent live activity

// Global warming potential constant (TCRE - Transient Climate Response to Cumulative Emissions).
// Based on IPCC AR6: ~4.5e-16 °C per kg CO₂e emitted.
const GLOBAL_WARMING_C_PER_KG = 4.5e-16;
let telemetryTable = null;

const LIVE_TTL_ENV = Number(process.env.ROUTE_OPTIMIZATION_LIVE_TTL_MS);
const LIVE_DEBOUNCE_ENV = Number(process.env.ROUTE_OPTIMIZATION_LIVE_DEBOUNCE_MS);
const LIVE_LOOKBACK_ENV = Number(process.env.ROUTE_OPTIMIZATION_LIVE_LOOKBACK_MINUTES);
const LIVE_OPTIMIZATION_TTL_MS =
  Number.isFinite(LIVE_TTL_ENV) && LIVE_TTL_ENV > 0 ? LIVE_TTL_ENV : 10 * 60 * 1000;
const LIVE_OPTIMIZATION_DEBOUNCE_MS =
  Number.isFinite(LIVE_DEBOUNCE_ENV) && LIVE_DEBOUNCE_ENV > 0 ? LIVE_DEBOUNCE_ENV : 3000;
const LIVE_LOOKBACK_MINUTES =
  Number.isFinite(LIVE_LOOKBACK_ENV) && LIVE_LOOKBACK_ENV > 0 ? LIVE_LOOKBACK_ENV : 180;

const liveOptimizationState = new Map();
let liveOptimizationTimer = null;
let liveOptimizationRunning = false;
const liveTelemetryCache = new Map();
const LIVE_CACHE_MAX_POINTS = 600;
const LIVE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveTelemetryTotal(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (samples.length === 1) return samples[0];
  const isMonotonic = samples.every(
    (value, index, arr) => index === 0 || value >= arr[index - 1]
  );
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (isMonotonic && Number.isFinite(first) && Number.isFinite(last) && last >= first) {
    return last - first;
  }
  return samples.reduce(
    (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
    0
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
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

function coordsFromRow(row) {
  const lat = row.lat ?? row.latitude;
  const lng = row.lng ?? row.longitude ?? row.long;
  return {
    lat: toNumber(lat, NaN),
    lng: toNumber(lng, NaN),
  };
}

function toGeoJsonLine(coordsLatLng) {
  if (!Array.isArray(coordsLatLng) || coordsLatLng.length < 2) return null;
  return {
    type: 'LineString',
    coordinates: coordsLatLng.map(([lat, lng]) => [lng, lat]),
  };
}

function geoJsonToLatLngList(geo) {
  if (!geo || geo.type !== 'LineString' || !Array.isArray(geo.coordinates)) return [];
  return geo.coordinates
    .map((pair) => {
      if (!Array.isArray(pair) || pair.length < 2) return null;
      const [lng, lat] = pair;
      const latNum = toNumber(lat, NaN);
      const lngNum = toNumber(lng, NaN);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
      return [latNum, lngNum];
    })
    .filter(Boolean);
}

async function resolveTelemetryTable() {
  if (telemetryTable) return telemetryTable;
  try {
    const { rows } = await pool.query(`SELECT to_regclass('telemetry_history') AS exists`);
    telemetryTable = rows[0]?.exists ? 'telemetry_history' : 'telemetry';
  } catch {
    telemetryTable = 'telemetry';
  }
  return telemetryTable;
}

function enableLiveOptimization(truckIds, ttlMs = LIVE_OPTIMIZATION_TTL_MS) {
  if (!Array.isArray(truckIds)) return;
  const expiresAt = Date.now() + ttlMs;
  truckIds.forEach((id) => {
    const key = String(id);
    const current = liveOptimizationState.get(key) || {};
    liveOptimizationState.set(key, {
      enabledUntil: Math.max(current.enabledUntil || 0, expiresAt),
      lastRunAt: current.lastRunAt || 0,
    });
  });
}

function disableLiveOptimization(truckIds) {
  if (truckIds === 'all') {
    liveOptimizationState.clear();
    return;
  }
  if (!Array.isArray(truckIds)) return;
  truckIds.forEach((id) => liveOptimizationState.delete(String(id)));
}

function shouldRunLiveOptimization(truckId) {
  const key = String(truckId);
  const state = liveOptimizationState.get(key);
  if (!state) return false;
  const now = Date.now();
  if (state.enabledUntil && now > state.enabledUntil) {
    liveOptimizationState.delete(key);
    return false;
  }
  if (state.lastRunAt && now - state.lastRunAt < LIVE_OPTIMIZATION_DEBOUNCE_MS) {
    return false;
  }
  state.lastRunAt = now;
  liveOptimizationState.set(key, state);
  return true;
}

function recordTelemetrySample(truckId, row) {
  if (!truckId || !row) return;
  const key = String(truckId);
  const list = liveTelemetryCache.get(key) || [];
  const ts = row.timestamp ? new Date(row.timestamp) : new Date();
  const normalized = { ...row, truck_id: truckId, timestamp: ts.toISOString() };
  list.push(normalized);

  const cutoff = Date.now() - LIVE_CACHE_MAX_AGE_MS;
  const trimmed = list.filter((item) => {
    const itemTs = item.timestamp ? new Date(item.timestamp).getTime() : 0;
    return !itemTs || itemTs >= cutoff;
  });

  if (trimmed.length > LIVE_CACHE_MAX_POINTS) {
    trimmed.splice(0, trimmed.length - LIVE_CACHE_MAX_POINTS);
  }

  liveTelemetryCache.set(key, trimmed);
}

function getCachedTelemetryWindow(truckId, lookbackMinutes) {
  const key = String(truckId);
  const list = liveTelemetryCache.get(key);
  if (!list || !list.length) return [];
  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  return list.filter((row) => {
    const ts = row.timestamp ? new Date(row.timestamp).getTime() : 0;
    return !ts || ts >= cutoff;
  });
}

function getLiveTelemetrySnapshot() {
  const samples = [];
  for (const list of liveTelemetryCache.values()) {
    if (Array.isArray(list) && list.length) {
      samples.push(...list);
    }
  }
  return samples;
}

function getLiveOptimizationTruckIds() {
  const now = Date.now();
  const ids = [];
  for (const [key, state] of liveOptimizationState.entries()) {
    if (!state?.enabledUntil || now > state.enabledUntil) {
      liveOptimizationState.delete(key);
      continue;
    }
    ids.push(key);
  }
  return ids;
}

async function buildOptimizationSnapshot(truckId, options = {}) {
  const lookbackMinutes = options.lookbackMinutes ?? LIVE_LOOKBACK_MINUTES;
  const telemetryRows = await fetchTelemetryWindow(truckId, lookbackMinutes);
  if (!telemetryRows.length) return null;

  const fuelType =
    telemetryRows.find((r) => r.fuel_type)?.fuel_type || (await fetchTruckFuelType(truckId));
  const baseline = buildBaselineMetrics(telemetryRows, fuelType);
  if (!baseline || baseline.baselineDistanceKm === 0) return null;

  const optimization = computeOptimization(baseline);
  const baselineGeo = toGeoJsonLine(baseline.routeLatLng);
  const optimizedGeo = toGeoJsonLine(optimization.optimizedRouteLatLng);

  const snapshotRow = {
    id: null,
    truck_id: truckId,
    trip_id: baseline.tripId,
    executed_at: new Date().toISOString(),
    baseline_from: baseline.startTs,
    baseline_to: baseline.endTs,
    fuel_type: baseline.fuelType,
    baseline_distance_km: baseline.baselineDistanceKm,
    optimized_distance_km: optimization.optimizedDistanceKm,
    reduced_distance_km: optimization.reducedDistanceKm,
    baseline_time_minutes: baseline.baselineTimeMinutes,
    optimized_time_minutes: optimization.optimizedTimeMinutes,
    time_saved_minutes: optimization.timeSavedMinutes,
    baseline_fuel_liters: optimization.baselineFuelLiters,
    optimized_fuel_liters: optimization.optimizedFuelLiters,
    fuel_saved_liters: optimization.fuelSavedLiters,
    baseline_co2_kg: optimization.baselineCo2Kg,
    optimized_co2_kg: optimization.optimizedCo2Kg,
    reduced_co2_kg: optimization.reducedCo2Kg,
    baseline_co_kg: optimization.baselineCoKg,
    optimized_co_kg: optimization.optimizedCoKg,
    reduced_co_kg: optimization.reducedCoKg,
    global_warming_delta_c: optimization.globalWarmingDeltaC,
    baseline_route_geojson: baselineGeo,
    optimized_route_geojson: optimizedGeo,
    meta: {
      source: 'live-telemetry',
      improvementFactor: optimization.improvementFactor,
      avgSpeedKmh: baseline.avgSpeedKmh,
      totalStops: baseline.totalStops,
      totalWasteKg: baseline.totalWasteKg,
      totalCo2Kg: baseline.totalCo2Kg,
      totalCoKg: baseline.totalCoKg,
      totalFuelLiters: baseline.totalFuelLiters,
      fuelType: baseline.fuelType,
      pointCount: baseline.pointCount,
      distanceDeltaKm: optimization.distanceDeltaKm,
      gpsDistanceKm: baseline.gpsDistanceKm,
      odometerDistanceKm: baseline.odometerDistanceKm,
      telemetryDistanceKm: baseline.telemetryDistanceKm,
      reducedDistanceKm: optimization.reducedDistanceKm,
      timeSavedMinutes: optimization.timeSavedMinutes,
      reducedCo2Kg: optimization.reducedCo2Kg,
      reducedCoKg: optimization.reducedCoKg,
      fuelSavedLiters: optimization.fuelSavedLiters,
    },
  };

  return mapOptimizationRow(snapshotRow);
}

async function emitLiveOptimizationUpdates(io, options = {}) {
  if (!io || liveOptimizationRunning) return null;
  liveOptimizationRunning = true;
  try {
    const truckIds = getLiveOptimizationTruckIds();
    if (!truckIds.length) return null;
    const lookbackMinutes = options.lookbackMinutes ?? LIVE_LOOKBACK_MINUTES;
    const truckOptimizations = [];

    for (const id of truckIds) {
      if (!shouldRunLiveOptimization(id)) continue;
      const snapshot = await buildOptimizationSnapshot(Number(id), { lookbackMinutes });
      if (snapshot) truckOptimizations.push(snapshot);
    }

    if (!truckOptimizations.length) return null;
    const totals = aggregateOptimization(truckOptimizations);
    io.emit('route:optimized', { truckOptimizations, totals });
    return { truckOptimizations, totals };
  } catch (err) {
    console.error('Live optimization stream failed', err);
    return null;
  } finally {
    liveOptimizationRunning = false;
  }
}

function startLiveOptimizationStream(io, intervalMs = 10000, options = {}) {
  if (liveOptimizationTimer) return;
  emitLiveOptimizationUpdates(io, options).catch((err) =>
    console.error('Initial live optimization update failed', err)
  );
  liveOptimizationTimer = setInterval(
    () => emitLiveOptimizationUpdates(io, options),
    intervalMs
  );
}

function stopLiveOptimizationStream() {
  if (liveOptimizationTimer) {
    clearInterval(liveOptimizationTimer);
    liveOptimizationTimer = null;
  }
}

async function ensureRouteOptimizationTable() {
  // Full DDL aligned with the PostgreSQL definition you shared
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_optimizations (
      id BIGSERIAL PRIMARY KEY,
      truck_id integer NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
      trip_id integer,
      executed_at timestamptz NOT NULL DEFAULT NOW(),
      baseline_from timestamptz,
      baseline_to timestamptz,
      baseline_distance_km numeric(12,3) NOT NULL,
      optimized_distance_km numeric(12,3) NOT NULL,
      reduced_distance_km numeric(12,3) GENERATED ALWAYS AS (baseline_distance_km - optimized_distance_km) STORED,
      baseline_time_minutes numeric(12,2) NOT NULL,
      optimized_time_minutes numeric(12,2) NOT NULL,
      time_saved_minutes numeric(12,2) GENERATED ALWAYS AS (baseline_time_minutes - optimized_time_minutes) STORED,
      fuel_type varchar(20) NOT NULL,
      baseline_fuel_liters numeric(12,3),
      optimized_fuel_liters numeric(12,3),
      fuel_saved_liters numeric(12,3) GENERATED ALWAYS AS (
        CASE
          WHEN baseline_fuel_liters IS NULL OR optimized_fuel_liters IS NULL THEN NULL
          ELSE baseline_fuel_liters - optimized_fuel_liters
        END
      ) STORED,
      baseline_co2_kg numeric(12,3),
      optimized_co2_kg numeric(12,3),
      reduced_co2_kg numeric(12,3) GENERATED ALWAYS AS (
        CASE
          WHEN baseline_co2_kg IS NULL OR optimized_co2_kg IS NULL THEN NULL
          ELSE baseline_co2_kg - optimized_co2_kg
        END
      ) STORED,
      baseline_co_kg numeric(12,3),
      optimized_co_kg numeric(12,3),
      reduced_co_kg numeric(12,3) GENERATED ALWAYS AS (
        CASE
          WHEN baseline_co_kg IS NULL OR optimized_co_kg IS NULL THEN NULL
          ELSE baseline_co_kg - optimized_co_kg
        END
      ) STORED,
      global_warming_delta_c numeric(12,6),
      vehicle_id bigint,
      original_distance_km numeric(12,3),
      distance_saved_km numeric(12,3),
      co2_saved_kg numeric(12,6),
      co_saved_kg numeric(12,6),
      created_at timestamptz NOT NULL DEFAULT NOW(),
      baseline_route_geojson jsonb,
      optimized_route_geojson jsonb,
      meta jsonb,
      CONSTRAINT chk_route_opt_non_negative CHECK (
        baseline_distance_km >= 0 AND optimized_distance_km >= 0 AND
        baseline_time_minutes >= 0 AND optimized_time_minutes >= 0
      ),
      CONSTRAINT route_opt_fuel_type_check CHECK (
        fuel_type::text = ANY (ARRAY['diesel','petrol','cng','electric','hybrid'])
      )
    )
  `);

  // Add any columns introduced after the initial version (for existing tables)
  const alterStatements = [
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS fuel_type varchar(20) NOT NULL DEFAULT 'diesel'",
    "ALTER TABLE route_optimizations ALTER COLUMN fuel_type DROP DEFAULT",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_fuel_liters numeric(12,3)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS optimized_fuel_liters numeric(12,3)",
    `ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS fuel_saved_liters numeric(12,3)
      GENERATED ALWAYS AS (
        CASE
          WHEN baseline_fuel_liters IS NULL OR optimized_fuel_liters IS NULL THEN NULL
          ELSE baseline_fuel_liters - optimized_fuel_liters
        END
      ) STORED`,
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_co2_kg numeric(12,3)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS optimized_co2_kg numeric(12,3)",
    `ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS reduced_co2_kg numeric(12,3)
      GENERATED ALWAYS AS (
        CASE
          WHEN baseline_co2_kg IS NULL OR optimized_co2_kg IS NULL THEN NULL
          ELSE baseline_co2_kg - optimized_co2_kg
        END
      ) STORED`,
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_co_kg numeric(12,3)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS optimized_co_kg numeric(12,3)",
    `ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS reduced_co_kg numeric(12,3)
      GENERATED ALWAYS AS (
        CASE
          WHEN baseline_co_kg IS NULL OR optimized_co_kg IS NULL THEN NULL
          ELSE baseline_co_kg - optimized_co_kg
        END
      ) STORED`,
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS global_warming_delta_c numeric(12,6)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_from timestamptz",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_to timestamptz",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS baseline_route_geojson jsonb",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS optimized_route_geojson jsonb",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS meta jsonb",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS vehicle_id bigint",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS original_distance_km numeric(12,3)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS distance_saved_km numeric(12,3)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS co2_saved_kg numeric(12,6)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS co_saved_kg numeric(12,6)",
    "ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()",
    // Loosen constraints on derived columns to stay compatible with existing schemas
    "ALTER TABLE route_optimizations ALTER COLUMN reduced_distance_km DROP NOT NULL",
    "ALTER TABLE route_optimizations ALTER COLUMN time_saved_minutes DROP NOT NULL",
    "ALTER TABLE route_optimizations ALTER COLUMN reduced_co2_kg DROP NOT NULL",
    "ALTER TABLE route_optimizations ALTER COLUMN reduced_co_kg DROP NOT NULL",
    "ALTER TABLE route_optimizations ALTER COLUMN fuel_saved_liters DROP NOT NULL"
  ];
  for (const stmt of alterStatements) {
    await pool.query(stmt);
  }

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_route_opt_executed_at ON route_optimizations (executed_at DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_route_opt_truck_time ON route_optimizations (truck_id, executed_at DESC)'
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_route_opt_vehicle_executed ON route_optimizations (vehicle_id, executed_at DESC)'
  );
  await pool.query('CREATE INDEX IF NOT EXISTS idx_route_opt_trip ON route_optimizations (trip_id)');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_route_opt_meta_gin ON route_optimizations USING GIN (meta)'
  );
}

async function fetchActiveTruckIds() {
  const { rows } = await pool.query(
    `SELECT id
     FROM trucks
     WHERE status IS NULL OR LOWER(status) != 'inactive'
     ORDER BY id`
  );
  return rows.map((r) => r.id);
}

async function fetchTruckFuelType(truckId) {
  try {
    const { rows } = await pool.query('SELECT fuel_type FROM trucks WHERE id = $1', [truckId]);
    return rows[0]?.fuel_type || 'diesel';
  } catch {
    return 'diesel';
  }
}

async function fetchTelemetryWindow(truckId, lookbackMinutes = DEFAULT_LOOKBACK_MINUTES) {
  const cached = getCachedTelemetryWindow(truckId, lookbackMinutes);
  if (cached.length >= 2) {
    return cached;
  }
  const table = await resolveTelemetryTable();
  const { rows } = await pool.query(
    `
    SELECT id, truck_id, trip_id, timestamp, lat, lng, speed_kmh, distance_km,
           fuel_liters, waste_kg, co2_kg, co_kg, fuel_type, stops, odometer_km
    FROM ${table}
    WHERE truck_id = $1
      AND timestamp >= NOW() - ($2 || ' minutes')::interval
    ORDER BY timestamp ASC, id ASC
  `,
    [truckId, lookbackMinutes]
  );

  if (rows.length === 0 && table !== 'telemetry') {
    const fallback = await pool.query(
      `SELECT id, truck_id, trip_id, timestamp, lat, lng, speed_kmh, distance_km,
              fuel_liters, waste_kg, co2_kg, co_kg, fuel_type, stops, odometer_km
       FROM telemetry
       WHERE truck_id = $1
         AND timestamp >= NOW() - ($2 || ' minutes')::interval
       ORDER BY timestamp ASC, id ASC`,
      [truckId, lookbackMinutes]
    );
    if (fallback.rows.length) {
      return fallback.rows;
    }
  }

  // Fallback: if the recent window has no rows, grab the latest 200 points for this truck
  if (rows.length === 0) {
    let fallback = await pool.query(
      `SELECT id, truck_id, trip_id, timestamp, lat, lng, speed_kmh, distance_km,
              fuel_liters, waste_kg, co2_kg, co_kg, fuel_type, stops, odometer_km
       FROM ${table}
       WHERE truck_id = $1
       ORDER BY timestamp DESC, id DESC
       LIMIT 50`,
      [truckId]
    );
    if (fallback.rows.length === 0 && table !== 'telemetry') {
      fallback = await pool.query(
        `SELECT id, truck_id, trip_id, timestamp, lat, lng, speed_kmh, distance_km,
                fuel_liters, waste_kg, co2_kg, co_kg, fuel_type, stops, odometer_km
         FROM telemetry
         WHERE truck_id = $1
         ORDER BY timestamp DESC, id DESC
         LIMIT 50`,
        [truckId]
      );
    }
    return fallback.rows.reverse(); // keep chronological order
  }

  return rows;
}

function buildBaselineMetrics(rows, defaultFuelType = 'diesel') {
  if (!rows || !rows.length) return null;

  const routeLatLng = [];
  let gpsDistanceKm = 0;
  const distanceSamples = [];
  let odometerDistanceKm = null;
  const fuelSamples = [];
  let totalWasteKg = 0;
  const co2Samples = [];
  const coSamples = [];
  let totalStops = 0;
  let lastCoords = null;
  let fuelType = defaultFuelType;
  let speedSum = 0;
  let speedCount = 0;

  rows.forEach((row) => {
    if (row.fuel_type) fuelType = row.fuel_type;
    const fuelLiters = toNumber(row.fuel_liters ?? row.fuelLiters, NaN);
    if (Number.isFinite(fuelLiters)) {
      fuelSamples.push(fuelLiters);
    }
    const coords = coordsFromRow(row);
    if (Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      routeLatLng.push([coords.lat, coords.lng]);
      if (lastCoords) {
        gpsDistanceKm += haversineKm(
          lastCoords.lat,
          lastCoords.lng,
          coords.lat,
          coords.lng
        );
      }
      lastCoords = coords;
    }

    const distanceValue = toNumber(row.distance_km ?? row.distanceKm, NaN);
    if (Number.isFinite(distanceValue)) {
      distanceSamples.push(distanceValue);
    }

    totalStops += toNumber(row.stops, 0);
    totalWasteKg += toNumber(row.waste_kg ?? row.wasteKg, 0);

    const rowCo2 = toNumber(row.co2_kg ?? row.co2Kg, NaN);
    if (Number.isFinite(rowCo2)) co2Samples.push(rowCo2);
    const rowCo = toNumber(row.co_kg ?? row.coKg, NaN);
    if (Number.isFinite(rowCo)) coSamples.push(rowCo);

    const speed = toNumber(row.speed_kmh ?? row.speedKmh, NaN);
    if (Number.isFinite(speed)) {
      speedSum += speed;
      speedCount += 1;
    }
  });

  // fallback distance from odometer if haversine failed
  const startOdo = toNumber(rows[0]?.odometer_km, null);
  const endOdo = toNumber(rows[rows.length - 1]?.odometer_km, null);
  if (Number.isFinite(startOdo) && Number.isFinite(endOdo) && endOdo >= startOdo) {
    odometerDistanceKm = endOdo - startOdo;
  }

  let telemetryDistanceKm = null;
  if (distanceSamples.length > 1) {
    const isMonotonic = distanceSamples.every(
      (value, index, arr) => index === 0 || value >= arr[index - 1]
    );
    const first = distanceSamples[0];
    const last = distanceSamples[distanceSamples.length - 1];
    if (isMonotonic && Number.isFinite(first) && Number.isFinite(last) && last >= first) {
      telemetryDistanceKm = last - first;
    } else {
      telemetryDistanceKm = distanceSamples.reduce(
        (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
        0
      );
    }
  } else if (distanceSamples.length === 1 && distanceSamples[0] > 0) {
    telemetryDistanceKm = distanceSamples[0];
  }

  // ✅ FIX: Instead of relying on potentially noisy or cumulative DB columns,
  // we derive baseline emissions from the traveled distance. 
  // This ensures the "Reduction" is a pure comparison of "Current Route" vs "Optimized Route"
  // and stays proportional to the map movement.
  let totalFuelLiters = resolveTelemetryTotal(fuelSamples);
  const baselineCo2Kg = calcCo2FromFuel(telemetryDistanceKm || gpsDistanceKm, fuelType);
  const baselineCoKg = calcCoFromCo2(baselineCo2Kg, fuelType);

  // If DB actually had higher values (e.g. heavy idle), we can use them, 
  // but we cap them to avoid the "4 million kg" bug.
  const rawCo2 = resolveTelemetryTotal(co2Samples);
  let totalCo2Kg = (rawCo2 > 0 && rawCo2 < baselineCo2Kg * 5) ? rawCo2 : baselineCo2Kg;
  let totalCoKg = calcCoFromCo2(totalCo2Kg, fuelType);

  const startTs = rows[0]?.timestamp ? new Date(rows[0].timestamp) : null;
  const endTs = rows[rows.length - 1]?.timestamp ? new Date(rows[rows.length - 1].timestamp) : null;
  let baselineTimeMinutes = 0;
  if (startTs && endTs && endTs > startTs) {
    baselineTimeMinutes = (endTs - startTs) / 1000 / 60;
  } else {
    // assume 2 minutes between points if timestamps are missing
    baselineTimeMinutes = rows.length * 2;
  }

  let avgSpeedKmh = speedCount ? speedSum / speedCount : null;
  if (!Number.isFinite(avgSpeedKmh) || avgSpeedKmh === null) {
    avgSpeedKmh = baselineTimeMinutes > 0
      ? (gpsDistanceKm / (baselineTimeMinutes / 60))
      : 0;
  }

  const baselineDistanceKm =
    Number.isFinite(odometerDistanceKm) && odometerDistanceKm > 0
      ? odometerDistanceKm
      : Number.isFinite(telemetryDistanceKm) && telemetryDistanceKm > 0
        ? telemetryDistanceKm
        : gpsDistanceKm > 0
          ? gpsDistanceKm
          : avgSpeedKmh > 0 && baselineTimeMinutes > 0
            ? avgSpeedKmh * (baselineTimeMinutes / 60)
            : 0;

  const tripId =
    rows.find((r) => r.trip_id !== null && r.trip_id !== undefined)?.trip_id ?? null;

  return {
    tripId,
    fuelType,
    routeLatLng,
    startTs,
    endTs,
    baselineDistanceKm: Number(baselineDistanceKm.toFixed(3)),
    baselineTimeMinutes: Number(baselineTimeMinutes.toFixed(1)),
    gpsDistanceKm: Number(gpsDistanceKm.toFixed(3)),
    odometerDistanceKm: Number.isFinite(odometerDistanceKm) ? Number(odometerDistanceKm.toFixed(3)) : null,
    telemetryDistanceKm: Number.isFinite(telemetryDistanceKm) ? Number(telemetryDistanceKm.toFixed(3)) : null,
    avgSpeedKmh: Number(avgSpeedKmh.toFixed(1)),
    totalWasteKg: Number(totalWasteKg.toFixed(2)),
    totalCo2Kg: Number.isFinite(totalCo2Kg) ? Number(totalCo2Kg.toFixed(3)) : 0,
    totalCoKg: Number.isFinite(totalCoKg) ? Number(totalCoKg.toFixed(3)) : 0,
    totalFuelLiters: Number.isFinite(totalFuelLiters) ? Number(totalFuelLiters.toFixed(3)) : null,
    totalStops,
    pointCount: routeLatLng.length,
  };
}

function deriveImprovementFactor(metrics) {
  let factor = 0.08; // base 8%
  if (metrics.totalStops > 5) factor += 0.04;
  if (metrics.baselineDistanceKm > 25) factor += 0.05;
  if (metrics.avgSpeedKmh && metrics.avgSpeedKmh < 25) factor += 0.02;
  if (metrics.totalWasteKg > 200) factor += 0.03;
  return Math.min(factor, 0.25); // cap at 25%
}

function buildOptimizedRoute(baselineRoute, improvementFactor) {
  if (!Array.isArray(baselineRoute) || baselineRoute.length < 2) {
    return baselineRoute || [];
  }
  const keepCount = Math.max(2, Math.ceil(baselineRoute.length * (1 - improvementFactor / 2)));
  return baselineRoute.slice(0, keepCount);
}

function computeOptimization(metrics) {
  const improvementFactor = deriveImprovementFactor(metrics);
  const baselineDistanceKm = metrics.baselineDistanceKm;

  const optimizedDistanceKm = Number(
    (baselineDistanceKm * (1 - improvementFactor)).toFixed(3)
  );

  const reducedDistanceKm = Number((baselineDistanceKm - optimizedDistanceKm).toFixed(3));
  const distanceDeltaKm = Number((optimizedDistanceKm - baselineDistanceKm).toFixed(3)); // negative when reduced

  const optimizedTimeMinutes = Number(
    (metrics.baselineTimeMinutes * (optimizedDistanceKm / Math.max(baselineDistanceKm, 0.0001))).toFixed(1)
  );
  const timeSavedMinutes = Number(
    (metrics.baselineTimeMinutes - optimizedTimeMinutes).toFixed(1)
  );

  const optimizedRouteLatLng = buildOptimizedRoute(metrics.routeLatLng, improvementFactor);

  // Fuel & emissions scaled by distance to estimate savings when switching to the optimized path
  const baselineFuelLiters = Number.isFinite(metrics.totalFuelLiters)
    ? Number(metrics.totalFuelLiters.toFixed(3))
    : null;
  const fuelPerKm =
    baselineFuelLiters !== null && baselineDistanceKm > 0
      ? baselineFuelLiters / baselineDistanceKm
      : null;
  const optimizedFuelLiters =
    fuelPerKm !== null
      ? Number((optimizedDistanceKm * fuelPerKm).toFixed(3))
      : baselineFuelLiters;

  const baselineCo2Kg = Number.isFinite(metrics.totalCo2Kg)
    ? Number(metrics.totalCo2Kg.toFixed(3))
    : baselineFuelLiters !== null
      ? Number(calcCo2FromFuel(baselineFuelLiters, metrics.fuelType).toFixed(3))
      : null;
  const optimizedCo2Kg =
    baselineCo2Kg !== null && baselineDistanceKm > 0
      ? Number((baselineCo2Kg * (optimizedDistanceKm / baselineDistanceKm)).toFixed(3))
      : optimizedFuelLiters !== null
        ? Number(calcCo2FromFuel(optimizedFuelLiters, metrics.fuelType).toFixed(3))
        : null;

  const baselineCoKg = Number.isFinite(metrics.totalCoKg)
    ? Number(metrics.totalCoKg.toFixed(3))
    : baselineCo2Kg !== null
      ? Number(calcCoFromCo2(baselineCo2Kg).toFixed(3))
      : null;
  const optimizedCoKg =
    baselineCoKg !== null && baselineDistanceKm > 0
      ? Number((baselineCoKg * (optimizedDistanceKm / baselineDistanceKm)).toFixed(3))
      : optimizedCo2Kg !== null
        ? Number(calcCoFromCo2(optimizedCo2Kg).toFixed(3))
        : null;

  const reducedCo2Kg =
    baselineCo2Kg !== null && optimizedCo2Kg !== null
      ? Number((baselineCo2Kg - optimizedCo2Kg).toFixed(3))
      : 0;
  const reducedCoKg =
    baselineCoKg !== null && optimizedCoKg !== null
      ? Number((baselineCoKg - optimizedCoKg).toFixed(3))
      : 0;
  const fuelSavedLiters =
    baselineFuelLiters !== null && optimizedFuelLiters !== null
      ? Number((baselineFuelLiters - optimizedFuelLiters).toFixed(3))
      : null;

  const co2eReducedKg = carbonFootprintKg(reducedCo2Kg, reducedCoKg);
  const globalWarmingDeltaC = Number(
    (-co2eReducedKg * GLOBAL_WARMING_C_PER_KG).toFixed(18)
  );

  return {
    improvementFactor,
    optimizedDistanceKm,
    reducedDistanceKm,
    distanceDeltaKm,
    optimizedTimeMinutes,
    timeSavedMinutes,
    baselineFuelLiters,
    optimizedFuelLiters,
    fuelSavedLiters,
    baselineCo2Kg,
    optimizedCo2Kg,
    baselineCoKg,
    optimizedCoKg,
    reducedCo2Kg,
    reducedCoKg,
    optimizedRouteLatLng,
    globalWarmingDeltaC,
  };
}

async function insertOptimization(truckId, payload) {
  const {
    tripId,
    startTs,
    endTs,
    baselineDistanceKm,
    optimizedDistanceKm,
    reducedDistanceKm,
    distanceDeltaKm,
    baselineTimeMinutes,
    optimizedTimeMinutes,
    baselineFuelLiters,
    optimizedFuelLiters,
    fuelSavedLiters,
    baselineCo2Kg,
    optimizedCo2Kg,
    baselineCoKg,
    optimizedCoKg,
    timeSavedMinutes,
    reducedCo2Kg,
    reducedCoKg,
    globalWarmingDeltaC,
    routeLatLng,
    optimizedRouteLatLng,
    improvementFactor,
    avgSpeedKmh,
    totalStops,
    totalWasteKg,
    totalCo2Kg,
    totalCoKg,
    totalFuelLiters,
    fuelType,
    pointCount,
    gpsDistanceKm,
    odometerDistanceKm,
    telemetryDistanceKm,
    vehicleId,
  } = payload;

  const baselineGeo = toGeoJsonLine(routeLatLng);
  const optimizedGeo = toGeoJsonLine(optimizedRouteLatLng);
  const originalDistanceKm = Number.isFinite(baselineDistanceKm) ? baselineDistanceKm : null;
  const distanceSavedKm = Number.isFinite(reducedDistanceKm) ? reducedDistanceKm : null;
  const co2SavedKg = Number.isFinite(reducedCo2Kg) ? reducedCo2Kg : null;
  const coSavedKg = Number.isFinite(reducedCoKg) ? reducedCoKg : null;

  const meta = {
    source: 'telemetry-window',
    improvementFactor,
    avgSpeedKmh,
    totalStops,
    totalWasteKg,
    totalCo2Kg,
    totalCoKg,
    totalFuelLiters,
    fuelType,
    pointCount,
    distanceDeltaKm,
    gpsDistanceKm,
    odometerDistanceKm,
    telemetryDistanceKm,
    reducedDistanceKm,
    timeSavedMinutes,
    reducedCo2Kg,
    reducedCoKg,
    fuelSavedLiters,
  };

  const { rows } = await pool.query(
    `
    INSERT INTO route_optimizations (
      truck_id, trip_id, baseline_from, baseline_to,
      baseline_distance_km, optimized_distance_km, original_distance_km, distance_saved_km,
      baseline_time_minutes, optimized_time_minutes,
      fuel_type, baseline_fuel_liters, optimized_fuel_liters,
      baseline_co2_kg, optimized_co2_kg, co2_saved_kg,
      baseline_co_kg, optimized_co_kg, co_saved_kg,
      global_warming_delta_c,
      vehicle_id,
      baseline_route_geojson, optimized_route_geojson, meta
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING *
  `,
    [
      truckId,
      tripId,
      startTs,
      endTs,
      baselineDistanceKm,
      optimizedDistanceKm,
      originalDistanceKm,
      distanceSavedKm,
      baselineTimeMinutes,
      optimizedTimeMinutes,
      fuelType,
      baselineFuelLiters,
      optimizedFuelLiters,
      baselineCo2Kg,
      optimizedCo2Kg,
      co2SavedKg,
      baselineCoKg,
      optimizedCoKg,
      coSavedKg,
      globalWarmingDeltaC,
      vehicleId ?? null,
      baselineGeo,
      optimizedGeo,
      meta,
    ]
  );

  return rows[0];
}

async function optimizeTruck(truckId, options = {}) {
  const lookbackMinutes = options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  const telemetryRows = await fetchTelemetryWindow(truckId, lookbackMinutes);
  if (!telemetryRows.length) {
    console.log(`[optimize] Truck ${truckId}: no telemetry rows found — skipping`);
    return null;
  }

  const fuelType = telemetryRows.find((r) => r.fuel_type)?.fuel_type || (await fetchTruckFuelType(truckId));
  const baseline = buildBaselineMetrics(telemetryRows, fuelType);
  if (!baseline || baseline.baselineDistanceKm === 0) {
    console.log(
      `[optimize] Truck ${truckId}: baselineDistanceKm=0 (rows=${telemetryRows.length}, ` +
      `gps=${baseline?.gpsDistanceKm}, odo=${baseline?.odometerDistanceKm}, ` +
      `tel=${baseline?.telemetryDistanceKm}) — skipping`
    );
    return null;
  }

  console.log(
    `[optimize] Truck ${truckId}: rows=${telemetryRows.length}, dist=${baseline.baselineDistanceKm}km, ` +
    `fuel=${fuelType}, co2=${baseline.totalCo2Kg}kg, co=${baseline.totalCoKg}kg`
  );
  const optimization = computeOptimization(baseline);
  const inserted = await insertOptimization(truckId, { ...baseline, ...optimization });

  return mapOptimizationRow(inserted);
}

function aggregateOptimization(truckOptimizations = []) {
  if (!truckOptimizations.length) {
    return {
      efficiencyGain: 0,
      reducedDistanceKm: 0,
      reducedCo2Kg: 0,
      reducedCoKg: 0,
      timeSavedMinutes: 0,
      globalWarmingDeltaC: 0,
      baselineDistanceKm: 0,
      optimizedDistanceKm: 0,
      distanceDeltaKm: 0,
      fuelSavedLiters: 0,
      baselineFuelLiters: 0,
      optimizedFuelLiters: 0,
      baselineCo2Kg: 0,
      optimizedCo2Kg: 0,
      baselineCoKg: 0,
      optimizedCoKg: 0,
    };
  }

  const totals = truckOptimizations.reduce(
    (acc, row) => {
      acc.reducedDistanceKm += toNumber(row.reducedDistanceKm, 0);
      acc.reducedCo2Kg += toNumber(row.reducedCo2Kg, 0);
      acc.reducedCoKg += toNumber(row.reducedCoKg, 0);
      acc.timeSavedMinutes += toNumber(row.timeSavedMinutes, 0);
      acc.globalWarmingDeltaC += toNumber(row.globalWarmingDeltaC, 0);
      acc.baselineDistanceKm += toNumber(row.baselineDistanceKm, 0);
      acc.optimizedDistanceKm += toNumber(row.optimizedDistanceKm, 0);
      acc.distanceDeltaKm += toNumber(row.distanceDeltaKm, 0);
      acc.fuelSavedLiters += toNumber(row.fuelSavedLiters, 0);
      acc.baselineFuelLiters += toNumber(row.baselineFuelLiters, 0);
      acc.optimizedFuelLiters += toNumber(row.optimizedFuelLiters, 0);
      acc.baselineCo2Kg += toNumber(row.baselineCo2Kg, 0);
      acc.optimizedCo2Kg += toNumber(row.optimizedCo2Kg, 0);
      acc.baselineCoKg += toNumber(row.baselineCoKg, 0);
      acc.optimizedCoKg += toNumber(row.optimizedCoKg, 0);
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
      distanceDeltaKm: 0,
      fuelSavedLiters: 0,
      baselineFuelLiters: 0,
      optimizedFuelLiters: 0,
      baselineCo2Kg: 0,
      optimizedCo2Kg: 0,
      baselineCoKg: 0,
      optimizedCoKg: 0,
    }
  );

  totals.efficiencyGain =
    totals.baselineDistanceKm > 0
      ? Number(((totals.reducedDistanceKm / totals.baselineDistanceKm) * 100).toFixed(1))
      : 0;

  totals.reducedDistanceKm = Number(totals.reducedDistanceKm.toFixed(3));
  totals.reducedCo2Kg = Number(totals.reducedCo2Kg.toFixed(3));
  totals.reducedCoKg = Number(totals.reducedCoKg.toFixed(3));
  totals.timeSavedMinutes = Number(totals.timeSavedMinutes.toFixed(1));
  totals.globalWarmingDeltaC = Number(totals.globalWarmingDeltaC.toFixed(18));
  totals.baselineDistanceKm = Number(totals.baselineDistanceKm.toFixed(3));
  totals.optimizedDistanceKm = Number(totals.optimizedDistanceKm.toFixed(3));
  totals.distanceDeltaKm = Number(totals.distanceDeltaKm.toFixed(3));
  totals.fuelSavedLiters = Number(totals.fuelSavedLiters.toFixed(3));
  totals.baselineFuelLiters = Number(totals.baselineFuelLiters.toFixed(3));
  totals.optimizedFuelLiters = Number(totals.optimizedFuelLiters.toFixed(3));
  totals.baselineCo2Kg = Number(totals.baselineCo2Kg.toFixed(3));
  totals.optimizedCo2Kg = Number(totals.optimizedCo2Kg.toFixed(3));
  totals.baselineCoKg = Number(totals.baselineCoKg.toFixed(3));
  totals.optimizedCoKg = Number(totals.optimizedCoKg.toFixed(3));
  return totals;
}

function mapOptimizationRow(row) {
  const baselineRoute = geoJsonToLatLngList(row.baseline_route_geojson);
  const optimizedRoute = geoJsonToLatLngList(row.optimized_route_geojson);
  const baselineDistanceKm = toNumber(
    row.baseline_distance_km ?? row.original_distance_km,
    0
  );
  const optimizedDistanceKm = toNumber(row.optimized_distance_km, 0);
  const reducedDistanceRaw = toNumber(
    row.reduced_distance_km ?? row.distance_saved_km,
    NaN
  );
  const reducedDistanceKm = Number.isFinite(reducedDistanceRaw)
    ? reducedDistanceRaw
    : Number((baselineDistanceKm - optimizedDistanceKm).toFixed(3));
  const distanceDeltaKm = Number((optimizedDistanceKm - baselineDistanceKm).toFixed(3));

  const baselineTimeMinutes = toNumber(row.baseline_time_minutes, 0);
  const optimizedTimeMinutes = toNumber(row.optimized_time_minutes, 0);
  const timeSavedRaw = toNumber(row.time_saved_minutes, NaN);
  const timeSavedMinutes = Number.isFinite(timeSavedRaw)
    ? timeSavedRaw
    : Number((baselineTimeMinutes - optimizedTimeMinutes).toFixed(1));

  const baselineFuelLiters =
    row.baseline_fuel_liters === null || row.baseline_fuel_liters === undefined
      ? null
      : toNumber(row.baseline_fuel_liters, NaN);
  const optimizedFuelLiters =
    row.optimized_fuel_liters === null || row.optimized_fuel_liters === undefined
      ? null
      : toNumber(row.optimized_fuel_liters, NaN);
  const fuelSavedRaw = toNumber(row.fuel_saved_liters, NaN);
  const fuelSavedLiters = Number.isFinite(fuelSavedRaw)
    ? fuelSavedRaw
    : Number.isFinite(baselineFuelLiters) && Number.isFinite(optimizedFuelLiters)
      ? Number((baselineFuelLiters - optimizedFuelLiters).toFixed(3))
      : null;

  const baselineCo2Kg =
    row.baseline_co2_kg === null || row.baseline_co2_kg === undefined
      ? null
      : toNumber(row.baseline_co2_kg, NaN);
  const optimizedCo2Kg =
    row.optimized_co2_kg === null || row.optimized_co2_kg === undefined
      ? null
      : toNumber(row.optimized_co2_kg, NaN);
  const reducedCo2Raw = toNumber(row.reduced_co2_kg ?? row.co2_saved_kg, NaN);
  const reducedCo2Kg = Number.isFinite(reducedCo2Raw)
    ? reducedCo2Raw
    : Number.isFinite(baselineCo2Kg) && Number.isFinite(optimizedCo2Kg)
      ? Number((baselineCo2Kg - optimizedCo2Kg).toFixed(3))
      : 0;

  const baselineCoKg =
    row.baseline_co_kg === null || row.baseline_co_kg === undefined
      ? null
      : toNumber(row.baseline_co_kg, NaN);
  const optimizedCoKg =
    row.optimized_co_kg === null || row.optimized_co_kg === undefined
      ? null
      : toNumber(row.optimized_co_kg, NaN);
  const reducedCoRaw = toNumber(row.reduced_co_kg ?? row.co_saved_kg, NaN);
  const reducedCoKg = Number.isFinite(reducedCoRaw)
    ? reducedCoRaw
    : Number.isFinite(baselineCoKg) && Number.isFinite(optimizedCoKg)
      ? Number((baselineCoKg - optimizedCoKg).toFixed(3))
      : 0;

  const warmingRaw = toNumber(row.global_warming_delta_c, NaN);
  let globalWarmingDeltaC;
  if (Number.isFinite(warmingRaw)) {
    globalWarmingDeltaC = warmingRaw;
  } else {
    const co2eKg = carbonFootprintKg(reducedCo2Kg, reducedCoKg);
    globalWarmingDeltaC = Number(
      (-co2eKg * GLOBAL_WARMING_C_PER_KG).toFixed(18)
    );
  }

  return {
    id: row.id,
    truckId: row.truck_id,
    tripId: row.trip_id,
    executedAt: row.executed_at,
    baselineFrom: row.baseline_from,
    baselineTo: row.baseline_to,
    fuelType: row.fuel_type || row.meta?.fuelType,
    baselineDistanceKm,
    optimizedDistanceKm,
    reducedDistanceKm,
    distanceDeltaKm,
    baselineTimeMinutes,
    optimizedTimeMinutes,
    timeSavedMinutes,
    baselineFuelLiters: Number.isFinite(baselineFuelLiters) ? baselineFuelLiters : null,
    optimizedFuelLiters: Number.isFinite(optimizedFuelLiters) ? optimizedFuelLiters : null,
    fuelSavedLiters,
    baselineCo2Kg: Number.isFinite(baselineCo2Kg) ? baselineCo2Kg : null,
    optimizedCo2Kg: Number.isFinite(optimizedCo2Kg) ? optimizedCo2Kg : null,
    reducedCo2Kg,
    baselineCoKg: Number.isFinite(baselineCoKg) ? baselineCoKg : null,
    optimizedCoKg: Number.isFinite(optimizedCoKg) ? optimizedCoKg : null,
    reducedCoKg,
    globalWarmingDeltaC,
    baselineRoute,
    optimizedRoute,
    meta: row.meta || {},
  };
}

async function latestOptimizations(truckIdParam = 'all') {
  await ensureRouteOptimizationTable();

  if (truckIdParam && truckIdParam !== 'all') {
    const idNum = Number(truckIdParam);
    if (!Number.isFinite(idNum)) {
      return { truckOptimizations: [], totals: aggregateOptimization([]) };
    }
    const { rows } = await pool.query(
      `SELECT * FROM route_optimizations WHERE truck_id = $1 ORDER BY executed_at DESC LIMIT 1`,
      [idNum]
    );
    const mapped = rows.map(mapOptimizationRow);
    return { truckOptimizations: mapped, totals: aggregateOptimization(mapped) };
  }

  const { rows } = await pool.query(`
    SELECT *
    FROM (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY truck_id ORDER BY executed_at DESC) AS rn
      FROM route_optimizations
    ) t
    WHERE rn = 1
  `);
  const mapped = rows.map(mapOptimizationRow);
  return { truckOptimizations: mapped, totals: aggregateOptimization(mapped) };
}

async function optimizeFleet(truckIds, options = {}) {
  await ensureRouteOptimizationTable();
  const truckOptimizations = [];
  for (const id of truckIds) {
    const result = await optimizeTruck(id, options);
    if (result) truckOptimizations.push(result);
  }
  const totals = aggregateOptimization(truckOptimizations);
  return { truckOptimizations, totals };
}

let autoOptimizeTimer = null;
let autoOptimizeRunning = false;

async function runAutoRouteOptimization(io, options = {}) {
  if (autoOptimizeRunning) return null;
  autoOptimizeRunning = true;
  try {
    const truckIds = await fetchActiveTruckIds();
    if (!truckIds.length) return null;
    const result = await optimizeFleet(truckIds, options);
    if (io && result.truckOptimizations.length) {
      io.emit('route:optimized', result);
    }
    return result;
  } catch (err) {
    console.error('Auto route optimization failed', err);
    return null;
  } finally {
    autoOptimizeRunning = false;
  }
}

function startAutoRouteOptimization(io, intervalMs = 60000, options = {}) {
  if (autoOptimizeTimer) return;
  runAutoRouteOptimization(io, options).catch((err) =>
    console.error('Initial auto route optimization failed', err)
  );
  autoOptimizeTimer = setInterval(() => runAutoRouteOptimization(io, options), intervalMs);
}

function stopAutoRouteOptimization() {
  if (autoOptimizeTimer) {
    clearInterval(autoOptimizeTimer);
    autoOptimizeTimer = null;
  }
}

module.exports = {
  ensureRouteOptimizationTable,
  optimizeTruck,
  optimizeFleet,
  latestOptimizations,
  aggregateOptimization,
  enableLiveOptimization,
  disableLiveOptimization,
  shouldRunLiveOptimization,
  buildOptimizationSnapshot,
  startLiveOptimizationStream,
  stopLiveOptimizationStream,
  recordTelemetrySample,
  getLiveTelemetrySnapshot,
  startAutoRouteOptimization,
  stopAutoRouteOptimization,
};
