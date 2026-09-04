const express = require('express');
const auth = require('../authMiddleware');
const {
  listTrucks,
  getTruckById,
  createTruck,
  updateTruck,
  deleteTruck,
  getLatestTelemetry,
  getTelemetryWindow,
} = require('../controllers/trucksController');
const pool = require('../db');

const router = express.Router();

router.get('/', auth, listTrucks);
router.get('/emissions/summary', auth, async (req, res) => {
  // Fleet emissions summary expected by Trucks.jsx SummaryCards.
  // Returns total CO2 for the requested period (default 7 days).
  try {
    const days = Number(req.query.days) || 7;

    // Try telemetry_history first, fallback to telemetry
    let table = 'telemetry';
    try {
      const { rows } = await pool.query(`SELECT to_regclass('telemetry_history') AS exists`);
      if (rows[0]?.exists) table = 'telemetry_history';
    } catch {
      // ignore
    }

    const query = `
      SELECT
        COALESCE(SUM(co2_kg), 0) AS total_co2_kg,
        COALESCE(SUM(co_kg), 0) AS total_co_kg,
        COALESCE(SUM(waste_kg), 0) AS total_waste_kg,
        COUNT(*) AS sample_count
      FROM ${table}
      WHERE timestamp >= NOW() - ($1 || ' days')::interval
    `;

    let { rows } = await pool.query(query, [days]);
    if (Number(rows[0]?.sample_count || 0) === 0 && table !== 'telemetry') {
      ({ rows } = await pool.query(query.replace(table, 'telemetry'), [days]));
    }

    const summary = rows[0] || {};
    return res.json({
      total_co2_kg: Number(summary.total_co2_kg || 0),
      totalCo2Kg: Number(summary.total_co2_kg || 0),
      total_co_kg: Number(summary.total_co_kg || 0),
      total_waste_kg: Number(summary.total_waste_kg || 0),
      days,
    });
  } catch (err) {
    console.error('Fleet emissions summary failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', auth, getTruckById);
router.post('/', auth, createTruck);
router.put('/:id', auth, updateTruck);
router.delete('/:id', auth, deleteTruck);
router.get('/:id/telemetry/latest', auth, getLatestTelemetry);
router.get('/:id/telemetry', auth, getTelemetryWindow);

// Stub endpoints for client-defined routes that may not be actively used yet
// but must return valid JSON to prevent frontend crashes.

router.get('/:id/trips', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid truck id' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM trips WHERE truck_id = $1 ORDER BY started_at DESC LIMIT 50',
      [id]
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Truck trips failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/emissions', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid truck id' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM trip_emissions WHERE truck_id = $1 ORDER BY calculated_at DESC LIMIT 50',
      [id]
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Truck emissions failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/waste-load-events', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid truck id' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM waste_load_events WHERE truck_id = $1 ORDER BY loaded_at DESC LIMIT 50',
      [id]
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Truck waste-load-events failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/rental', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid truck id' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM vehicle_rentals WHERE truck_id = $1 ORDER BY rental_start DESC LIMIT 10',
      [id]
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Truck rental failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
