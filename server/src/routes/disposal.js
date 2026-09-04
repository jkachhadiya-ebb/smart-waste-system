const express = require('express');
const pool = require('../db');
const auth = require('../authMiddleware');

const router = express.Router();

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
}

function parseDateParam(value) {
  if (value === undefined || value === null || value === '') {
    return { value: null, error: null };
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { value: null, error: 'Invalid date format' };
  }
  return { value: text, error: null };
}

function resolveMunicipalityId(req) {
  if (req.user?.municipality_id !== undefined && req.user?.municipality_id !== null) {
    const parsed = parseInteger(req.user.municipality_id);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const fallback = req.query.municipality_id ?? req.body?.municipality_id;
  if (fallback === undefined || fallback === null || fallback === '') {
    return null;
  }
  return parseInteger(fallback);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveTruckId(truckIdRaw) {
  const parsed = parseInteger(truckIdRaw);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const { rows } = await pool.query('SELECT id FROM trucks WHERE truck_code = $1', [
    String(truckIdRaw || '').trim(),
  ]);
  return rows[0]?.id ?? null;
}

router.get('/dashboard', auth, async (req, res, next) => {
  try {
    const municipalityId = resolveMunicipalityId(req);
    if (municipalityId === null) {
      return res.status(400).json({ message: 'municipality_id required' });
    }
    if (Number.isNaN(municipalityId)) {
      return res.status(400).json({ message: 'Invalid municipality_id' });
    }

    const from = parseDateParam(req.query.from);
    if (from.error) {
      return res.status(400).json({ message: from.error });
    }
    const to = parseDateParam(req.query.to);
    if (to.error) {
      return res.status(400).json({ message: to.error });
    }

    const { rows: municipalityRows } = await pool.query(
      `SELECT m.id, m.name,
              ls.id AS landfill_id,
              ls.name AS landfill_name,
              ls.capacity_m3,
              ls.used_m3
       FROM municipalities m
       LEFT JOIN landfill_sites ls ON ls.municipality_id = m.id
       WHERE m.id = $1`,
      [municipalityId]
    );

    if (!municipalityRows.length) {
      return res.status(404).json({ message: 'Municipality not found' });
    }

    const municipality = municipalityRows[0];

    const { rows: tableRows } = await pool.query(
      `SELECT *
       FROM v_disposal_ui_rows v
       WHERE v.municipality_id = $1
         AND ($2::date IS NULL OR v.date >= $2::date)
         AND ($3::date IS NULL OR v.date <= $3::date)
       ORDER BY v.date DESC, v.id DESC
       LIMIT 200`,
      [municipalityId, from.value, to.value]
    );

    const { rows: pieRows } = await pool.query(
      `SELECT
         COALESCE(SUM(total_weight_kg), 0) AS total_weight_kg,
         COALESCE(SUM(bio_kg), 0) AS bio_kg,
         COALESCE(SUM(plastic_kg), 0) AS plastic_kg,
         COALESCE(SUM(cardboard_kg), 0) AS cardboard_kg,
         COALESCE(SUM(metal_kg), 0) AS metal_kg,
         COALESCE(SUM(other_kg), 0) AS other_kg
       FROM disposal_events
       WHERE municipality_id = $1
         AND ($2::date IS NULL OR occurred_at::date >= $2::date)
         AND ($3::date IS NULL OR occurred_at::date <= $3::date)`,
      [municipalityId, from.value, to.value]
    );

    const pie = pieRows[0] || {};
    const totalWeightKg = toNumber(pie.total_weight_kg);
    const piePayload = {
      total_t: totalWeightKg / 1000,
      bio_t: toNumber(pie.bio_kg) / 1000,
      plastic_t: toNumber(pie.plastic_kg) / 1000,
      cardboard_t: toNumber(pie.cardboard_kg) / 1000,
      metal_t: toNumber(pie.metal_kg) / 1000,
      other_t: toNumber(pie.other_kg) / 1000,
    };

    const { rows: avgRows } = await pool.query(
      `SELECT COALESCE(SUM(load_volume_m3), 0) AS total_m3
       FROM disposal_events
       WHERE municipality_id = $1
         AND occurred_at >= NOW() - INTERVAL '14 days'`,
      [municipalityId]
    );

    const avgTotalM3 = toNumber(avgRows[0]?.total_m3);
    const avgM3PerDay = avgTotalM3 / 14;

    const capacity = toNumber(municipality.capacity_m3);
    const used = toNumber(municipality.used_m3);
    const remaining = Math.max(capacity - used, 0);
    const usedPercent = capacity > 0 ? (used / capacity) * 100 : 0;
    const daysToFill = avgM3PerDay > 0 ? remaining / avgM3PerDay : null;

    const rowsPayload = tableRows.map((row) => ({
      id: row.id,
      date: row.date,
      truck_id: row.truck_id,
      total_waste_t: toNumber(row.total_waste_t),
      bio_t: toNumber(row.bio_t),
      plastic_t: toNumber(row.plastic_t),
      cardboard_t: toNumber(row.cardboard_t),
      metal_t: toNumber(row.metal_t),
      other_t: toNumber(row.other_t),
      landfill_used_m3: toNumber(row.landfill_used_m3),
      landfill_total_used_m3: toNumber(row.landfill_total_used_m3),
      municipality_id: row.municipality_id,
      landfill_site_id: row.landfill_site_id,
    }));

    return res.json({
      municipality: {
        id: municipality.id,
        name: municipality.name,
      },
      landfill: {
        id: municipality.landfill_id,
        name: municipality.landfill_name,
        capacity_m3: capacity,
        used_m3: used,
        remaining_m3: remaining,
        used_percent: usedPercent,
        days_to_fill: daysToFill,
        avg_m3_per_day: avgM3PerDay,
      },
      pie: piePayload,
      rows: rowsPayload,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/events', auth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const municipalityId = resolveMunicipalityId(req);
    if (municipalityId === null) {
      client.release();
      return res.status(400).json({ message: 'municipality_id required' });
    }
    if (Number.isNaN(municipalityId)) {
      client.release();
      return res.status(400).json({ message: 'Invalid municipality_id' });
    }

    const totalWeight = Number(req.body?.total_weight_kg);
    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      client.release();
      return res.status(400).json({ message: 'total_weight_kg required' });
    }

    const truckIdRaw = req.body?.truck_id;
    if (!truckIdRaw) {
      client.release();
      return res.status(400).json({ message: 'truck_id required' });
    }
    const truckId = await resolveTruckId(truckIdRaw);
    if (!truckId) {
      client.release();
      return res.status(400).json({ message: 'Invalid truck_id' });
    }

    let tripId = null;
    if (req.body?.trip_id !== undefined && req.body?.trip_id !== null && req.body?.trip_id !== '') {
      const parsedTrip = parseInteger(req.body.trip_id);
      if (Number.isNaN(parsedTrip)) {
        client.release();
        return res.status(400).json({ message: 'Invalid trip_id' });
      }
      tripId = parsedTrip;
    }

    let occurredAt = null;
    if (req.body?.occurred_at) {
      const date = new Date(req.body.occurred_at);
      if (Number.isNaN(date.getTime())) {
        client.release();
        return res.status(400).json({ message: 'Invalid occurred_at' });
      }
      occurredAt = req.body.occurred_at;
    }

    await client.query('BEGIN');

    // Resolve landfill site
    const { rows: landfillRows } = await client.query(
      'SELECT id, capacity_m3, used_m3, density_kg_per_m3 FROM landfill_sites WHERE municipality_id = $1 LIMIT 1',
      [municipalityId]
    );
    const landfill = landfillRows[0];
    if (!landfill) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ message: 'Landfill site not configured' });
    }

    // Resolve waste rules (default ratios if none configured)
    const { rows: ruleRows } = await client.query(
      'SELECT * FROM waste_rules WHERE municipality_id = $1',
      [municipalityId]
    );
    const rules = ruleRows[0] || {
      bio_ratio: 0.30,
      plastic_ratio: 0.24,
      cardboard_ratio: 0.28,
      metal_ratio: 0.11,
      other_ratio: 0.07,
      density_kg_per_m3: 400,
    };

    // Use explicit breakdown from request body if provided, otherwise compute from ratios
    const bioKg = toNumber(req.body?.bio_kg) || totalWeight * toNumber(rules.bio_ratio);
    const plasticKg = toNumber(req.body?.plastic_kg) || totalWeight * toNumber(rules.plastic_ratio);
    const cardboardKg = toNumber(req.body?.cardboard_kg) || totalWeight * toNumber(rules.cardboard_ratio);
    const metalKg = toNumber(req.body?.metal_kg) || totalWeight * toNumber(rules.metal_ratio);
    const otherKg = toNumber(req.body?.other_kg) || totalWeight * toNumber(rules.other_ratio);

    // Compute volume using density (prefer landfill density, fallback to waste_rules density)
    const density = toNumber(landfill.density_kg_per_m3) || toNumber(rules.density_kg_per_m3) || 400;
    const loadVolumeM3 = totalWeight / density;

    // Check capacity
    const currentUsed = toNumber(landfill.used_m3);
    const capacity = toNumber(landfill.capacity_m3);
    const newUsed = currentUsed + loadVolumeM3;

    if (capacity > 0 && newUsed > capacity) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        message: 'Landfill capacity exceeded',
        details: {
          capacity_m3: capacity,
          current_used_m3: currentUsed,
          required_m3: loadVolumeM3,
          shortfall_m3: newUsed - capacity,
        },
      });
    }

    // Update landfill used_m3
    await client.query(
      'UPDATE landfill_sites SET used_m3 = $1 WHERE id = $2',
      [newUsed, landfill.id]
    );

    // Insert disposal event with computed values
    const { rows } = await client.query(
      `INSERT INTO disposal_events (
         municipality_id,
         landfill_site_id,
         truck_id,
         trip_id,
         occurred_at,
         total_weight_kg,
         bio_kg,
         plastic_kg,
         cardboard_kg,
         metal_kg,
         other_kg,
         load_volume_m3,
         landfill_used_before_m3,
         landfill_used_after_m3
       ) VALUES (
         $1, $2, $3, $4, COALESCE($5, NOW()), $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14
       )
       RETURNING *`,
      [
        municipalityId,
        landfill.id,
        truckId,
        tripId,
        occurredAt,
        totalWeight,
        bioKg,
        plasticKg,
        cardboardKg,
        metalKg,
        otherKg,
        loadVolumeM3,
        currentUsed,
        newUsed,
      ]
    );

    await client.query('COMMIT');
    client.release();

    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (!err) return next();
  const message = err.message || 'Server error';
  if (message.toLowerCase().includes('capacity exceeded')) {
    return res.status(409).json({ message: 'Landfill capacity exceeded' });
  }
  if (message.toLowerCase().includes('landfill site not found')) {
    return res.status(400).json({ message: 'Landfill site not found' });
  }
  if (message.toLowerCase().includes('municipality_id required')) {
    return res.status(400).json({ message: 'municipality_id required' });
  }
  console.error('Disposal route error', err);
  return res.status(500).json({ message: 'Server error' });
});

module.exports = router;
