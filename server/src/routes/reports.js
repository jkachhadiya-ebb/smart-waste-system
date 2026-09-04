const express = require('express');
const pool = require('../db');
const auth = require('../authMiddleware');
const { getLiveTelemetrySnapshot } = require('../services/routeOptimization');

const router = express.Router();

const RANGE_CONFIGS = {
  '12m': { bucket: 'month', interval: '12 months' },
  '30d': { bucket: 'day', interval: '30 days' },
  '24h': { bucket: 'hour', interval: '24 hours' },
  data: { bucket: 'auto', auto: true },
  live: { bucket: 'minute', interval: '2 hours' },
};

const LIVE_CACHE_TTL_MS = 3000;
const liveCache = new Map();
const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000;
const STOP_SPEED_KMH = 1;
const EMISSIONS_KG_SCALE = (() => {
  const raw = Number(process.env.EMISSIONS_KG_SCALE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();
let telemetryTables = null;

async function resolveTelemetryTables() {
  if (telemetryTables) return telemetryTables;
  try {
    const { rows } = await pool.query(`
      SELECT
        to_regclass('telemetry_history') AS telemetry_history,
        to_regclass('telemetry') AS telemetry
    `);
    const row = rows[0] || {};
    const ordered = [];
    if (row.telemetry_history) ordered.push('telemetry_history');
    if (row.telemetry) ordered.push('telemetry');
    telemetryTables = ordered;
  } catch {
    telemetryTables = ['telemetry'];
  }
  return telemetryTables;
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return NaN;
  return parsed;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getCachedResponse(cacheKey) {
  const cached = liveCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    liveCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedResponse(cacheKey, payload) {
  liveCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + LIVE_CACHE_TTL_MS,
  });
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isStopSample(sample) {
  const stopsRaw = sample.stops ?? sample.stop_count ?? sample.stop;
  const stops = Number(stopsRaw);
  if (Number.isFinite(stops) && stops > 0) return true;

  const speedRaw = sample.speed_kmh ?? sample.speedKmh ?? sample.speed;
  const speed = Number(speedRaw);
  if (Number.isFinite(speed)) return speed <= STOP_SPEED_KMH;

  return false;
}

function selectAutoBucket(spanMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(spanMs) || spanMs <= 0) return 'minute';
  if (spanMs >= 365 * dayMs) return 'year';
  if (spanMs >= 60 * dayMs) return 'month';
  if (spanMs >= 2 * dayMs) return 'day';
  if (spanMs >= 2 * 60 * 60 * 1000) return 'hour';
  return 'minute';
}

async function queryEmissionsSeriesAuto(municipalityId, includeAllVehicles) {
  const tables = await resolveTelemetryTables();
  if (!tables.length) return { rows: [], bucket: 'day' };
  const roleMatch =
    `regexp_replace(lower(btrim(coalesce(tr.vehicle_role, ''))), '[\\s-]+', '_', 'g')`;
  const rangeQuery = (tbl, includeRoleFilter) => `
    SELECT
      MIN(t.timestamp) AS min_ts,
      MAX(t.timestamp) AS max_ts
    FROM ${tbl} t
    JOIN trucks tr
      ON (tr.id::text = t.truck_id::text OR tr.truck_code = t.truck_id::text)
    WHERE 1=1
      ${includeRoleFilter ? `AND ${roleMatch} IN ('waste_truck', 'support_car')` : ''}
      AND ($1::int IS NULL OR tr.municipality_id = $1)
  `;
  const seriesQuery = (tbl, includeRoleFilter) => `
    SELECT
      date_trunc($1, t.timestamp) AS bucket,
      COALESCE(SUM(t.co2_kg), 0) AS co2_kg,
      COALESCE(SUM(t.co_kg), 0) AS co_kg
    FROM ${tbl} t
    JOIN trucks tr
      ON (tr.id::text = t.truck_id::text OR tr.truck_code = t.truck_id::text)
    WHERE t.timestamp >= $2
      AND t.timestamp <= $3
      ${includeRoleFilter ? `AND ${roleMatch} IN ('waste_truck', 'support_car')` : ''}
      AND ($4::int IS NULL OR tr.municipality_id = $4)
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const runForTable = async (tbl, includeRoleFilter) => {
    const { rows: rangeRows } = await pool.query(rangeQuery(tbl, includeRoleFilter), [
      municipalityId,
    ]);
    const minTs = rangeRows[0]?.min_ts;
    const maxTs = rangeRows[0]?.max_ts;
    if (!minTs || !maxTs) return null;
    const spanMs = new Date(maxTs).getTime() - new Date(minTs).getTime();
    const bucket = selectAutoBucket(spanMs);
    const { rows } = await pool.query(seriesQuery(tbl, includeRoleFilter), [
      bucket,
      minTs,
      maxTs,
      municipalityId,
    ]);
    if (!rows.length) return null;
    return { rows, bucket };
  };

  if (!includeAllVehicles) {
    for (const tbl of tables) {
      const result = await runForTable(tbl, true);
      if (result) return result;
    }
  }

  for (const tbl of tables) {
    const result = await runForTable(tbl, false);
    if (result) return result;
  }

  return { rows: [], bucket: 'day' };
}

async function queryEmissionsSeries(rangeConfig, municipalityId, includeAllVehicles) {
  if (rangeConfig.auto) {
    return queryEmissionsSeriesAuto(municipalityId, includeAllVehicles);
  }
  const tables = await resolveTelemetryTables();
  if (!tables.length) return { rows: [], bucket: rangeConfig.bucket };
  const params = [rangeConfig.bucket, rangeConfig.interval, municipalityId];
  const roleMatch =
    `regexp_replace(lower(btrim(coalesce(tr.vehicle_role, ''))), '[\\s-]+', '_', 'g')`;
  const buildQuery = (tbl, includeRoleFilter) => `
    WITH filtered AS (
      SELECT
        t.timestamp,
        t.co2_kg,
        t.co_kg
      FROM ${tbl} t
      JOIN trucks tr
        ON (tr.id::text = t.truck_id::text OR tr.truck_code = t.truck_id::text)
      WHERE 1=1
        ${includeRoleFilter ? `AND ${roleMatch} IN ('waste_truck', 'support_car')` : ''}
        AND ($3::int IS NULL OR tr.municipality_id = $3)
    ),
    anchor AS (
      SELECT MAX(timestamp) AS max_ts FROM filtered
    )
    SELECT
      date_trunc($1, f.timestamp) AS bucket,
      COALESCE(SUM(f.co2_kg), 0) AS co2_kg,
      COALESCE(SUM(f.co_kg), 0) AS co_kg
    FROM filtered f
    CROSS JOIN anchor
    WHERE f.timestamp >= COALESCE(anchor.max_ts, NOW()) - $2::interval
      AND f.timestamp <= COALESCE(anchor.max_ts, NOW())
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  if (!includeAllVehicles) {
    for (const tbl of tables) {
      const { rows } = await pool.query(buildQuery(tbl, true), params);
      if (rows.length) return { rows, bucket: rangeConfig.bucket };
    }
  }

  for (const tbl of tables) {
    const { rows } = await pool.query(buildQuery(tbl, false), params);
    if (rows.length) return { rows, bucket: rangeConfig.bucket };
  }

  return { rows: [], bucket: rangeConfig.bucket };
}

async function queryLiveEmissionsSeries(rangeConfig, municipalityId, stopOnly, includeAllVehicles) {
  if (rangeConfig.bucket !== 'minute') {
    return { rows: [], bucket: rangeConfig.bucket };
  }
  const samples = getLiveTelemetrySnapshot();
  if (!samples.length) return { rows: [], bucket: rangeConfig.bucket };

  const numericIds = new Set();
  const codeIds = new Set();

  samples.forEach((sample) => {
    const rawId = sample.truck_id ?? sample.truckId ?? sample.truck;
    if (rawId === undefined || rawId === null || rawId === '') return;
    const key = String(rawId).trim();
    if (!key) return;
    const num = Number(key);
    if (Number.isInteger(num)) {
      numericIds.add(num);
    } else {
      codeIds.add(key);
    }
  });

  if (!numericIds.size && !codeIds.size) {
    return { rows: [], bucket: rangeConfig.bucket };
  }

  const { rows: truckRows } = await pool.query(
    `SELECT id, truck_code, municipality_id, vehicle_role
     FROM trucks
     WHERE (array_length($1::int[], 1) IS NOT NULL AND id = ANY($1::int[]))
        OR (array_length($2::text[], 1) IS NOT NULL AND truck_code = ANY($2::text[]))`,
    [Array.from(numericIds), Array.from(codeIds)]
  );

  const metaMap = new Map();
  truckRows.forEach((row) => {
    const meta = {
      municipality_id: row.municipality_id,
      role: normalizeRole(row.vehicle_role),
    };
    if (row.id !== undefined && row.id !== null) {
      metaMap.set(String(row.id), meta);
    }
    if (row.truck_code) {
      metaMap.set(String(row.truck_code), meta);
    }
  });

  const latestTimestampMs = samples.reduce((max, sample) => {
    const ts = sample.timestamp ? new Date(sample.timestamp).getTime() : NaN;
    if (!Number.isFinite(ts)) return max;
    return Math.max(max, ts);
  }, 0);
  const anchorMs = latestTimestampMs || Date.now();
  const since = anchorMs - LIVE_WINDOW_MS;
  const buildBuckets = (requireRoleMatch) => {
    const buckets = new Map();
    samples.forEach((sample) => {
      const rawId = sample.truck_id ?? sample.truckId ?? sample.truck;
      if (rawId === undefined || rawId === null || rawId === '') return;
      const key = String(rawId).trim();
      if (!key) return;
      const meta = metaMap.get(key);
      if (!meta) return;
      if (requireRoleMatch && !['waste_truck', 'support_car'].includes(meta.role)) return;
      if (municipalityId !== null && meta.municipality_id !== municipalityId) return;
      if (stopOnly && !isStopSample(sample)) return;

      const ts = sample.timestamp ? new Date(sample.timestamp) : new Date(anchorMs);
      if (Number.isNaN(ts.getTime()) || ts.getTime() < since) return;

      const bucketDate = new Date(ts);
      bucketDate.setSeconds(0, 0);
      const bucketKey = bucketDate.toISOString();
      const entry = buckets.get(bucketKey) || { bucket: bucketKey, co2_kg: 0, co_kg: 0 };
      entry.co2_kg += toNumber(sample.co2_kg ?? sample.co2Kg);
      entry.co_kg += toNumber(sample.co_kg ?? sample.coKg);
      buckets.set(bucketKey, entry);
    });
    return buckets;
  };

  const requireRoleMatch = !includeAllVehicles;
  let buckets = buildBuckets(requireRoleMatch);
  if (!buckets.size && requireRoleMatch) {
    buckets = buildBuckets(false);
  }

  const rows = Array.from(buckets.values()).sort(
    (a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime()
  );

  return { rows, bucket: rangeConfig.bucket };
}

function buildDataset(rows, bucket) {
  let cumulativeTax = 0;
  let totalCo2e = 0;
  const { getCarbonTaxEurPerTonne, CO_TO_CO2E_FACTOR, TCRE_C_PER_KG } = require('../services/emissions');
  const taxEurPerTonne = getCarbonTaxEurPerTonne();

  const points = rows.map((row) => {
    const co2Kg = toNumber(row.co2_kg) * EMISSIONS_KG_SCALE;
    const coKg = toNumber(row.co_kg) * EMISSIONS_KG_SCALE;
    const co2eKg = co2Kg + coKg * CO_TO_CO2E_FACTOR;
    const taxInstant = (co2eKg / 1000) * taxEurPerTonne;
    cumulativeTax += taxInstant;

    const warmingC = co2eKg * TCRE_C_PER_KG;
    const warmingNano = warmingC * 1e9;
    const warmingPico = warmingC * 1e12;
    totalCo2e += co2eKg;

    return {
      bucket: new Date(row.bucket).toISOString(),
      co2_kg: co2Kg,
      co_kg: coKg,
      co2e_kg: co2eKg,
      tax_instant_eur: taxInstant,
      tax_cumulative_eur: cumulativeTax,
      warming_c: warmingC,
      warming_nano_c: warmingNano,
      warming_pico_c: warmingPico,
    };
  });

  const latest = points[points.length - 1];

  return {
    points,
    totals: {
      co2e_kg_total: totalCo2e,
      tax_total_eur: cumulativeTax,
      warming_c_latest: latest ? latest.warming_c : 0,
      warming_nano_c_latest: latest ? latest.warming_nano_c : 0,
      warming_pico_c_latest: latest ? latest.warming_pico_c : 0,
    },
    bucket,
  };
}

router.get('/emissions', auth, async (req, res) => {
  try {
    const rangeRaw = typeof req.query.range === 'string' ? req.query.range : 'live';
    const rangeConfig = RANGE_CONFIGS[rangeRaw];
    if (!rangeConfig) {
      return res.status(400).json({ message: 'Invalid range value' });
    }

    const liveParsed = parseBoolean(req.query.live);
    if (req.query.live !== undefined && liveParsed === null) {
      return res.status(400).json({ message: 'Invalid live flag' });
    }
    const liveEnabled = liveParsed === null ? false : liveParsed;

    const stopParsed = parseBoolean(req.query.stopOnly);
    if (req.query.stopOnly !== undefined && stopParsed === null) {
      return res.status(400).json({ message: 'Invalid stopOnly flag' });
    }
    const stopOnly = stopParsed === null ? false : stopParsed;

    const allVehiclesParsed = parseBoolean(req.query.allVehicles);
    if (req.query.allVehicles !== undefined && allVehiclesParsed === null) {
      return res.status(400).json({ message: 'Invalid allVehicles flag' });
    }
    const includeAllVehicles = allVehiclesParsed === null ? false : allVehiclesParsed;

    const compareARaw = req.query.compareA ?? req.query.compareA_municipality_id;
    const compareBRaw = req.query.compareB ?? req.query.compareB_municipality_id;
    const compareAId = parseOptionalInt(compareARaw);
    const compareBId = parseOptionalInt(compareBRaw);

    if (Number.isNaN(compareAId)) {
      return res.status(400).json({ message: 'Invalid compareA municipality id' });
    }
    if (Number.isNaN(compareBId)) {
      return res.status(400).json({ message: 'Invalid compareB municipality id' });
    }

    const baseMunicipalityId = null;

    const useCache = liveEnabled || rangeRaw === 'live';
    const cacheKey = JSON.stringify({
      range: rangeRaw,
      live: useCache,
      stopOnly,
      includeAllVehicles,
      baseMunicipalityId,
      compareAId,
      compareBId,
    });

    if (useCache) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const datasetCache = new Map();
    const fetchDataset = async (municipalityId) => {
      const cacheKeyLocal = municipalityId === null ? 'all' : String(municipalityId);
      if (datasetCache.has(cacheKeyLocal)) {
        return datasetCache.get(cacheKeyLocal);
      }
      const preferLiveTelemetry = rangeRaw === 'live';
      let result = preferLiveTelemetry
        ? await queryLiveEmissionsSeries(rangeConfig, municipalityId, stopOnly, includeAllVehicles)
        : await queryEmissionsSeries(rangeConfig, municipalityId, includeAllVehicles);
      if (preferLiveTelemetry && !result.rows.length && !stopOnly) {
        result = await queryEmissionsSeries(rangeConfig, municipalityId, includeAllVehicles);
      }
      const dataset = buildDataset(result.rows, result.bucket);
      datasetCache.set(cacheKeyLocal, dataset);
      return dataset;
    };

    const primaryDataset = await fetchDataset(baseMunicipalityId);
    const compareADataset = compareAId !== null ? await fetchDataset(compareAId) : null;
    const compareBDataset = compareBId !== null ? await fetchDataset(compareBId) : null;

    const payload = {
      range: rangeRaw,
      live: liveEnabled,
      generated_at: new Date().toISOString(),
      primary: {
        municipality_id: baseMunicipalityId,
        ...primaryDataset,
      },
      compareA: compareAId !== null ? { municipality_id: compareAId, ...compareADataset } : null,
      compareB: compareBId !== null ? { municipality_id: compareBId, ...compareBDataset } : null,
    };

    if (useCache) {
      setCachedResponse(cacheKey, payload);
    }

    return res.json(payload);
  } catch (err) {
    console.error('Report emissions failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/municipalities', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, municipality_code, city, state_region, address_lat, address_lng
       FROM municipalities
       ORDER BY name NULLS LAST, municipality_code NULLS LAST, id ASC`
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Municipality list failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Legacy default route (kept for compatibility)
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM trucks ORDER BY truck_code');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
