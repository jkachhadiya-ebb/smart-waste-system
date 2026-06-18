const express = require('express');
const pool = require('../db');
const auth = require('../authMiddleware');
const {
  optimizeFleet,
  latestOptimizations,
  aggregateOptimization,
  enableLiveOptimization,
  disableLiveOptimization,
} = require('../services/routeOptimization');

const router = express.Router();
let telemetryTable = null;

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

async function fetchActiveTruckIds(filterId = 'all') {
  if (filterId && filterId !== 'all') {
    const idNum = Number(filterId);
    if (!Number.isFinite(idNum)) return [];
    return [idNum];
  }
  const { rows } = await pool.query(
    `SELECT id
     FROM trucks
     WHERE status IS NULL OR LOWER(status) != 'inactive'
     ORDER BY id`
  );
  return rows.map((r) => r.id);
}

// GET /api/dashboard/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const truckIdRaw = req.query.truckId || 'all';
    const truckId = truckIdRaw !== 'all' ? Number(truckIdRaw) : 'all';
    if (truckIdRaw !== 'all' && !Number.isFinite(truckId)) {
      return res.status(400).json({ message: 'Invalid truckId filter' });
    }
    const includeOptimizations = ['1', 'true', 'yes'].includes(
      String(req.query.includeOptimizations || '').toLowerCase()
    );
    const table = await resolveTelemetryTable();

    // Use a subquery to get the latest telemetry snapshot for each truck, then sum them.
    // This gives the "Current Fleet Load" (Live status).
    const truckIdFilter = truckId && truckId !== 'all' ? `WHERE truck_id = ${Number(truckId)}` : '';
    const { rows: summaryRows } = await pool.query(
      `SELECT
        COUNT(*) AS active_trucks,
        COALESCE(SUM(waste_kg),0) AS waste_kg,
        COALESCE(SUM(co2_kg),0) AS co2_kg,
        COALESCE(SUM(co_kg),0) AS co_kg
       FROM (
         SELECT DISTINCT ON (truck_id) waste_kg, co2_kg, co_kg
         FROM ${table}
         ${truckIdFilter}
         ORDER BY truck_id, timestamp DESC
       ) t`
    );

    let summary = summaryRows[0] || {};

    // Fallback to 'telemetry' table if no results in 'telemetry_history'
    if (table !== 'telemetry' && Number(summary.active_trucks || 0) === 0) {
      const { rows: fallbackRows } = await pool.query(
        `SELECT
          COUNT(*) AS active_trucks,
          COALESCE(SUM(waste_kg),0) AS waste_kg,
          COALESCE(SUM(co2_kg),0) AS co2_kg,
          COALESCE(SUM(co_kg),0) AS co_kg
         FROM (
           SELECT DISTINCT ON (truck_id) waste_kg, co2_kg, co_kg
           FROM telemetry
           ${truckIdFilter}
           ORDER BY truck_id, timestamp DESC
         ) t`
      );
      summary = fallbackRows[0] || summary;
    }

    let truckOptimizations = [];
    let totals = aggregateOptimization([]);
    if (includeOptimizations) {
      ({ truckOptimizations, totals } = await latestOptimizations(truckId));
    }

    res.json({
      wasteKg: Number(summary.waste_kg || 0),
      co2Kg: Number(summary.co2_kg || 0),
      coKg: Number(summary.co_kg || 0),
      efficiencyGain: totals.efficiencyGain || 0,
      reducedDistanceKm: totals.reducedDistanceKm || 0,
      reducedCo2Kg: totals.reducedCo2Kg || 0,
      reducedCoKg: totals.reducedCoKg || 0,
      timeSavedMinutes: totals.timeSavedMinutes || 0,
      globalWarmingDeltaC: Number(totals.globalWarmingDeltaC || 0),
      totals,
      truckOptimizations,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/dashboard/optimize-routes
// POST /api/dashboard/optimize-routes
router.post('/optimize-routes', auth, async (req, res) => {
  try {
    const truckId = req.body.truckId || req.query.truckId || 'all';
    const truckIds = await fetchActiveTruckIds(truckId);

    if (!truckIds.length) {
      return res.status(400).json({ message: 'No trucks available for optimization' });
    }

    const result = await optimizeFleet(truckIds, { lookbackMinutes: 180 });
    enableLiveOptimization(truckIds);
    const io = req.app.get('io');
    if (io && result.truckOptimizations.length) {
      io.emit('route:optimized', result);
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/dashboard/stop-optimization
router.post('/stop-optimization', auth, async (req, res) => {
  try {
    const truckId = req.body.truckId || req.query.truckId || 'all';
    console.log(`Stopping optimization for truckId: ${truckId}`);
    const truckIds = truckId === 'all' ? 'all' : await fetchActiveTruckIds(truckId);
    disableLiveOptimization(truckIds);
    res.json({ success: true, message: 'Optimization stopped' });
  } catch (err) {
    console.error('Stop optimization failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/dashboard/live-trucks
// Returns the latest telemetry snapshot per active truck so the map can render
// truck positions immediately on page load (before socket events arrive).
router.get('/live-trucks', auth, async (req, res) => {
  try {
    const table = await resolveTelemetryTable();

    // Use DISTINCT ON to get one row per truck_id (the latest)
    let query = `
      SELECT DISTINCT ON (t.truck_id)
        t.truck_id,
        t.lat,
        t.lng,
        t.speed_kmh,
        t.waste_kg,
        t.co2_kg,
        t.co_kg,
        t.timestamp,
        t.fuel_type,
        tr.truck_code,
        tr.plate_number,
        tr.status AS truck_status
      FROM ${table} t
      LEFT JOIN trucks tr ON tr.id = t.truck_id
      WHERE t.lat IS NOT NULL
        AND t.lng IS NOT NULL
        AND (tr.status IS NULL OR LOWER(tr.status) != 'inactive')
      ORDER BY t.truck_id, t.timestamp DESC
    `;

    let { rows } = await pool.query(query);

    // Fallback to other table if no results
    if (rows.length === 0 && table !== 'telemetry') {
      ({ rows } = await pool.query(query.replace(new RegExp(table, 'g'), 'telemetry')));
    }

    const liveTrucks = rows.map((row) => ({
      truckId: String(row.truck_id),
      lat: Number(row.lat),
      lng: Number(row.lng),
      speedKmh: Number(row.speed_kmh || 0),
      wasteKg: Number(row.waste_kg || 0),
      co2Kg: Number(row.co2_kg || 0),
      coKg: Number(row.co_kg || 0),
      timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : new Date().toISOString(),
      type: row.truck_code || `Truck ${row.truck_id}`,
      truckCode: row.truck_code,
      plateNumber: row.plate_number,
      truckStatus: row.truck_status,
    }));

    res.json({ trucks: liveTrucks });
  } catch (err) {
    console.error('Live trucks failed', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
