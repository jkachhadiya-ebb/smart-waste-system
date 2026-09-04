// koblenzSimulator.js
const pool = require('../db');
const {
  shouldRunLiveOptimization,
  buildOptimizationSnapshot,
  aggregateOptimization,
  recordTelemetrySample,
} = require('./routeOptimization');

let ioInstance = null;
let sourceTable = 'telemetry';

async function maybeEmitLiveOptimization(truckId) {
  if (!ioInstance) return;
  if (!shouldRunLiveOptimization(truckId)) return;
  try {
    const snapshot = await buildOptimizationSnapshot(truckId);
    if (!snapshot) return;
    const totals = aggregateOptimization([snapshot]);
    ioInstance.emit('route:optimized', {
      truckOptimizations: [snapshot],
      totals,
    });
  } catch (err) {
    console.error('Live optimization update failed', err);
  }
}

function normalizeCoords(row) {
  const lat = row.lat ?? row.latitude;
  const lng = row.lng ?? row.longitude ?? row.long;
  return {
    lat: lat !== undefined && lat !== null ? Number(lat) : NaN,
    lng: lng !== undefined && lng !== null ? Number(lng) : NaN,
  };
}

function normalizeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function emitTelemetryRow(row, { optimize = false } = {}) {
  const truckId = row.truck_id ?? row.truckId ?? row.truck;
  if (!truckId) return;

  const coords = normalizeCoords(row);
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;

  let fuelType = row.fuel_type || 'diesel';
  if (!row.fuel_type) {
    try {
      const { rows } = await pool.query('SELECT fuel_type FROM trucks WHERE id = $1', [truckId]);
      if (rows[0]?.fuel_type) fuelType = rows[0].fuel_type;
    } catch {
      // Fuel type is optional for the live map.
    }
  }

  const payload = {
    truckId: String(truckId),
    timestamp: new Date().toISOString(),
    sourceTimestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
    lat: coords.lat,
    lng: coords.lng,
    speedKmh: normalizeNumber(row.speed_kmh ?? row.speedKmh, 0),
    wasteKg: normalizeNumber(row.waste_kg ?? row.wasteKg, 0),
    co2Kg: normalizeNumber(row.co2_kg ?? row.co2Kg, 0),
    coKg: normalizeNumber(row.co_kg ?? row.coKg, 0),
    fuelType,
    type: row.truck_code || row.type || row.truck_type || row.category || 'Simulation',
    truckCode: row.truck_code || null,
    municipalityId: row.municipality_id ? String(row.municipality_id) : null,
    municipalityCode: row.municipality_code || null,
    municipalityName: row.municipality_name || null,
    city: row.city || null,
    country: row.country || null,
    streetName: row.street_name || null,
    routePhase: row.route_phase || null,
    routeDirection: row.route_direction || null,
  };

  ioInstance.emit('telemetry:update', payload);
  if (optimize) {
    recordTelemetrySample(truckId, { ...row, timestamp: new Date().toISOString() });
    maybeEmitLiveOptimization(payload.truckId).catch(() => null);
  }
}

function initSimulator(io) {
  // Simulator must be explicitly enabled via env. Never runs in production by default.
  const enabled = process.env.ENABLE_SIMULATOR === 'true';
  if (!enabled) {
    console.log('Koblenz simulator is DISABLED (set ENABLE_SIMULATOR=true to enable)');
    return;
  }
  ioInstance = io;
  start().catch((e) => console.error('Simulator start failed:', e));
}

async function start() {
  await detectSourceTable();

  let offset = 0;
  const batchSize = 5;
  const atakumRoutes = new Map();
  const atakumPlayback = new Map();
  const configuredDestinationWaitMs = Number(process.env.ATAKUM_DESTINATION_WAIT_MS);
  const atakumDestinationWaitMs =
    Number.isFinite(configuredDestinationWaitMs) && configuredDestinationWaitMs >= 0
      ? configuredDestinationWaitMs
      : 30 * 1000;

  console.log('Fleet simulator started - following database road geometry every 3 seconds');

  setInterval(async () => {
    try {
      // Stable ordering to make OFFSET paging reliable
      const { rows } = await pool.query(
        `SELECT t.*, tr.truck_code, tr.municipality_id,
                m.municipality_code, m.name AS municipality_name, m.city, m.country
         FROM ${sourceTable} t
         LEFT JOIN trucks tr ON tr.id = t.truck_id
         LEFT JOIN municipalities m ON m.id = tr.municipality_id
         WHERE COALESCE(LOWER(m.city), '') <> 'atakum'
         ORDER BY t.timestamp ASC, t.id ASC
         LIMIT $1 OFFSET $2`,
        [batchSize, offset]
      );

      if (!rows.length) {
        offset = 0;
        console.log('Simulator: Restarting telemetry loop from beginning');
        return;
      }

      offset += rows.length;

      for (const r of rows) {
        await emitTelemetryRow(r, { optimize: true });
      }
    } catch (err) {
      console.error('Simulator error:', err.message);
    }
  }, 3000);

  setInterval(async () => {
    try {
      if (!atakumRoutes.size) {
        const { rows } = await pool.query(
          `SELECT t.*, tr.truck_code, tr.municipality_id,
                  m.municipality_code, m.name AS municipality_name, m.city, m.country
           FROM telemetry t
           JOIN trucks tr ON tr.id = t.truck_id
           JOIN municipalities m ON m.id = tr.municipality_id
           WHERE m.municipality_code = 'TR-SAM-ATAKUM'
           ORDER BY t.truck_id ASC, t.route_sequence ASC, t.timestamp ASC`
        );
        for (const row of rows) {
          const key = String(row.truck_id);
          if (!atakumRoutes.has(key)) atakumRoutes.set(key, []);
          atakumRoutes.get(key).push(row);
        }
      }

      const now = Date.now();
      for (const [truckId, route] of atakumRoutes) {
        if (!route.length) continue;
        const state = atakumPlayback.get(truckId) || {
          index: 0,
          direction: 1,
          holdUntil: 0,
        };
        const atDestination = state.index === route.length - 1;

        if (atDestination && state.direction === 1) {
          if (!state.holdUntil) state.holdUntil = now + atakumDestinationWaitMs;
          await emitTelemetryRow({
            ...route[state.index],
            speed_kmh: 0,
            route_phase: 'destination_wait',
            route_direction: 'outbound',
          });
          if (now < state.holdUntil) {
            atakumPlayback.set(truckId, state);
            continue;
          }
          state.direction = -1;
          state.holdUntil = 0;
          state.index = Math.max(0, state.index - 1);
        } else {
          await emitTelemetryRow({
            ...route[state.index],
            route_phase: state.direction === 1 ? 'outbound' : 'returning',
            route_direction: state.direction === 1 ? 'outbound' : 'return',
          });
          state.index += state.direction;
          if (state.index <= 0 && state.direction === -1) {
            state.index = 0;
            state.direction = 1;
          }
        }
        atakumPlayback.set(truckId, state);
      }
    } catch (err) {
      console.error('Atakum telemetry stream error:', err.message);
    }
  }, 3000);
}

async function detectSourceTable() {
  try {
    const { rows } = await pool.query(`SELECT to_regclass('telemetry_history') AS exists`);
    const exists = rows[0]?.exists;
    sourceTable = exists ? 'telemetry_history' : 'telemetry';
  } catch (err) {
    sourceTable = 'telemetry';
  }
}

module.exports = { initSimulator };
