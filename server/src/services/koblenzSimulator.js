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

  console.log('Koblenz simulator started - emitting telemetry every 3 seconds');

  setInterval(async () => {
    try {
      // Stable ordering to make OFFSET paging reliable
      const { rows } = await pool.query(
        `SELECT *
         FROM ${sourceTable}
         ORDER BY timestamp ASC, id ASC
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
        const truckId = r.truck_id ?? r.truckId ?? r.truck;
        if (!truckId) {
          console.warn('Simulator: Skipping row with missing truck_id', r);
          continue;
        }

        const coords = normalizeCoords(r);
        if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
          console.warn(`Simulator: Skipping row with invalid lat/lng for truck ${truckId}`);
          continue;
        }

        // Fuel type is optional; don't fail simulation if trucks row missing
        let fuelType = 'diesel';
        try {
          const { rows: truckRows } = await pool.query(
            'SELECT fuel_type FROM trucks WHERE id = $1',
            [truckId]
          );
          if (truckRows[0]?.fuel_type) fuelType = truckRows[0].fuel_type;
        } catch {
          // ignore
        }

        const ts = r.timestamp ? new Date(r.timestamp) : new Date();

        const payload = {
          truckId: String(truckId),
          timestamp: ts.toISOString(),
          lat: coords.lat,
          lng: coords.lng,
          speedKmh: normalizeNumber(r.speed_kmh ?? r.speedKmh, 0),
          wasteKg: normalizeNumber(r.waste_kg ?? r.wasteKg, 0),
          co2Kg: normalizeNumber(r.co2_kg ?? r.co2Kg, 0),
          coKg: normalizeNumber(r.co_kg ?? r.coKg, 0),
          fuelType,
          type: r.type ?? r.truck_type ?? r.category ?? 'Simulation',
        };

        if (ioInstance) {
          ioInstance.emit('telemetry:update', payload);
          recordTelemetrySample(truckId, { ...r, timestamp: new Date().toISOString() });
          maybeEmitLiveOptimization(payload.truckId).catch(() => null);
          console.log(
            `Simulator: Emitted telemetry for Truck ${payload.truckId} at (${payload.lat}, ${payload.lng})`
          );
        }
      }
    } catch (err) {
      console.error('Simulator error:', err.message);
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
