const pool = require('../db');

const FUEL_TYPES = new Set(['diesel', 'petrol', 'cng', 'electric', 'hybrid']);
const STATUS_TYPES = new Map([
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['maintenance', 'Maintenance'],
]);
const VEHICLE_ROLE_ALIASES = {
  waste_truck: 'waste_truck',
  wastetruck: 'waste_truck',
  waste: 'waste_truck',
  garbage: 'waste_truck',
  refuse: 'waste_truck',
  trash: 'waste_truck',
  support_car: 'support_car',
  supportcar: 'support_car',
  support: 'support_car',
  support_vehicle: 'support_car',
  support_truck: 'support_car',
  car: 'support_car',
  van: 'support_car',
};
const OWNERSHIP_ALIASES = {
  rented: 'rented',
  rent: 'rented',
  rental: 'rented',
  lease: 'rented',
  leased: 'rented',
  leasing: 'rented',
  municipality_owned: 'municipality_owned',
  municipality: 'municipality_owned',
  municipal: 'municipality_owned',
  city_owned: 'municipality_owned',
  city: 'municipality_owned',
  government: 'municipality_owned',
  govt: 'municipality_owned',
  public: 'municipality_owned',
  owned: 'municipality_owned',
};
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

async function queryLatestTelemetry(truckId) {
  const table = await resolveTelemetryTable();
  const buildQuery = (tbl) =>
    `SELECT *
     FROM ${tbl}
     WHERE truck_id = $1
     ORDER BY timestamp DESC, id DESC
     LIMIT 1`;
  let { rows } = await pool.query(buildQuery(table), [truckId]);
  if (!rows.length && table !== 'telemetry') {
    ({ rows } = await pool.query(buildQuery('telemetry'), [truckId]));
  }
  return rows;
}

async function queryTelemetryWindow(truckId, minutes) {
  const table = await resolveTelemetryTable();
  const buildQuery = (tbl) =>
    `SELECT *
     FROM ${tbl}
     WHERE truck_id = $1
       AND timestamp >= NOW() - ($2 || ' minutes')::interval
     ORDER BY timestamp ASC, id ASC`;
  let { rows } = await pool.query(buildQuery(table), [truckId, minutes]);
  if (!rows.length && table !== 'telemetry') {
    ({ rows } = await pool.query(buildQuery('telemetry'), [truckId, minutes]));
  }
  return rows;
}

function toTrimmedString(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length ? text : null;
}

function parseOptionalNumber(value, field, errors, { integer = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || (integer && !Number.isInteger(num))) {
    errors.push(`${field} must be a ${integer ? 'whole number' : 'number'}`);
    return undefined;
  }
  return num;
}

function normalizeStatus(value, errors) {
  if (value === undefined) return undefined;
  const key = String(value).trim().toLowerCase();
  if (!key) return null;
  const normalized = STATUS_TYPES.get(key);
  if (!normalized) {
    errors.push('status must be Active, Inactive, or Maintenance');
    return undefined;
  }
  return normalized;
}

function normalizeFuelType(value, required, errors) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push('fuel_type is required');
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!FUEL_TYPES.has(normalized)) {
    errors.push('fuel_type must be diesel, petrol, cng, electric, or hybrid');
    return undefined;
  }
  return normalized;
}

function normalizeVehicleRole(value, errors, { allowUnknown = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = VEHICLE_ROLE_ALIASES[normalized];
  if (mapped) return mapped;
  if (allowUnknown) return normalized;
  errors.push('vehicle_role must be waste_truck or support_car');
  return undefined;
}

function normalizeOwnershipType(value, errors, { allowUnknown = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = OWNERSHIP_ALIASES[normalized];
  if (mapped) return mapped;
  if (allowUnknown) return normalized;
  errors.push('ownership_type must be municipality_owned or rented');
  return undefined;
}

function parseTruckPayload(body, { requireFields = false } = {}) {
  const errors = [];
  const payload = {};

  const truckCode = toTrimmedString(body.truck_code);
  if (truckCode === undefined && requireFields) {
    errors.push('truck_code is required');
  } else if (truckCode !== undefined) {
    payload.truck_code = truckCode;
  }

  const plateNumber = toTrimmedString(body.plate_number);
  if (plateNumber !== undefined) payload.plate_number = plateNumber;

  const model = toTrimmedString(body.model);
  if (model !== undefined) payload.model = model;

  const gpsImei = toTrimmedString(body.gps_imei);
  if (gpsImei !== undefined) payload.gps_imei = gpsImei;

  const status = normalizeStatus(body.status, errors);
  if (status !== undefined) payload.status = status;

  const fuelType = normalizeFuelType(body.fuel_type, requireFields, errors);
  if (fuelType !== undefined) payload.fuel_type = fuelType;

  const capacityTons = parseOptionalNumber(body.capacity_tons, 'capacity_tons', errors);
  if (capacityTons !== undefined) payload.capacity_tons = capacityTons;

  const co2Factor = parseOptionalNumber(body.co2_factor_per_liter, 'co2_factor_per_liter', errors);
  if (co2Factor !== undefined) payload.co2_factor_per_liter = co2Factor;

  const coFactor = parseOptionalNumber(body.co_factor_per_liter, 'co_factor_per_liter', errors);
  if (coFactor !== undefined) payload.co_factor_per_liter = coFactor;

  const municipalityId = parseOptionalNumber(
    body.municipality_id,
    'municipality_id',
    errors,
    { integer: true }
  );
  if (municipalityId !== undefined) payload.municipality_id = municipalityId;

  const homeCenterId = parseOptionalNumber(
    body.home_center_id,
    'home_center_id',
    errors,
    { integer: true }
  );
  if (homeCenterId !== undefined) payload.home_center_id = homeCenterId;

  const vehicleRole = normalizeVehicleRole(body.vehicle_role, errors);
  if (vehicleRole !== undefined) payload.vehicle_role = vehicleRole;

  const ownershipType = normalizeOwnershipType(body.ownership_type, errors);
  if (ownershipType !== undefined) payload.ownership_type = ownershipType;

  return { payload, errors };
}

function parsePagination(query) {
  const pageRaw = query.page ?? '1';
  const limitRaw = query.limit ?? '20';
  const page = Number(pageRaw);
  const limit = Number(limitRaw);
  if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(limit) || limit <= 0) {
    return { error: 'page and limit must be positive numbers' };
  }
  return {
    page: Math.floor(page),
    limit: Math.min(100, Math.floor(limit)),
  };
}

function handleDbError(res, err) {
  if (err && err.code === '23505') {
    const detail = String(err.detail || '');
    if (detail.includes('truck_code')) {
      return res.status(409).json({ message: 'Truck code already exists' });
    }
    if (detail.includes('gps_imei')) {
      return res.status(409).json({ message: 'GPS IMEI already exists' });
    }
    return res.status(409).json({ message: 'Duplicate value violates a unique constraint' });
  }
  if (err && err.code === '23503') {
    return res.status(400).json({ message: 'Referenced record not found' });
  }
  console.error(err);
  return res.status(500).json({ message: 'Server error' });
}

async function listTrucks(req, res) {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ message: pagination.error });
    }
    const { page, limit } = pagination;

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const fuelRaw = typeof req.query.fuel_type === 'string' ? req.query.fuel_type.trim() : '';
    const roleRaw =
      typeof req.query.vehicle_role === 'string' ? req.query.vehicle_role.trim() : '';
    const ownershipRaw =
      typeof req.query.ownership_type === 'string' ? req.query.ownership_type.trim() : '';
    const municipalityRaw =
      req.query.municipality_id === undefined ? '' : String(req.query.municipality_id).trim();

    const filters = [];
    const params = [];
    const filterErrors = [];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      filters.push(
        `(truck_code ILIKE $${idx} OR plate_number ILIKE $${idx} OR model ILIKE $${idx} OR gps_imei ILIKE $${idx})`
      );
    }

    if (statusRaw) {
      const statusKey = statusRaw.toLowerCase();
      const normalized = STATUS_TYPES.get(statusKey);
      if (!normalized) {
        return res.status(400).json({ message: 'Invalid status filter' });
      }
      params.push(normalized);
      if (normalized === 'Active') {
        filters.push(`(status = $${params.length} OR status IS NULL)`);
      } else {
        filters.push(`status = $${params.length}`);
      }
    }

    if (fuelRaw) {
      const fuel = fuelRaw.toLowerCase();
      if (!FUEL_TYPES.has(fuel)) {
        return res.status(400).json({ message: 'Invalid fuel_type filter' });
      }
      params.push(fuel);
      filters.push(`fuel_type = $${params.length}`);
    }

    if (municipalityRaw) {
      const municipalityId = Number(municipalityRaw);
      if (!Number.isInteger(municipalityId)) {
        return res.status(400).json({ message: 'Invalid municipality_id filter' });
      }
      params.push(municipalityId);
      filters.push(`municipality_id = $${params.length}`);
    }

    if (roleRaw) {
      const role = normalizeVehicleRole(roleRaw, filterErrors, { allowUnknown: false });
      if (filterErrors.length) {
        return res.status(400).json({ message: 'Invalid vehicle_role filter' });
      }
      const roleBase =
        `regexp_replace(lower(btrim(coalesce(vehicle_role, ''))), '[\\s-]+', '_', 'g')`;
      const roleCanonical = `
        CASE
          WHEN ${roleBase} IN ('support_car','support','support_vehicle','support_truck','car','van','supportcar')
            THEN 'support_car'
          WHEN ${roleBase} IN ('waste_truck','waste','garbage','refuse','trash','wastetruck')
            THEN 'waste_truck'
          WHEN ${roleBase} = ''
            THEN CASE
              WHEN (coalesce(model, '') ILIKE '%support%'
                OR coalesce(model, '') ILIKE '%car%'
                OR coalesce(model, '') ILIKE '%van%'
                OR coalesce(truck_code, '') ILIKE '%support%'
                OR coalesce(truck_code, '') ILIKE '%car%'
                OR coalesce(truck_code, '') ILIKE '%van%')
                THEN 'support_car'
              ELSE 'waste_truck'
            END
          ELSE ${roleBase}
        END
      `;
      params.push(role);
      filters.push(`(${roleCanonical}) = $${params.length}`);
    }

    if (ownershipRaw) {
      const ownership = normalizeOwnershipType(ownershipRaw, filterErrors, { allowUnknown: false });
      if (filterErrors.length) {
        return res.status(400).json({ message: 'Invalid ownership_type filter' });
      }
      const ownershipBase =
        `regexp_replace(lower(btrim(coalesce(ownership_type, ''))), '[\\s-]+', '_', 'g')`;
      const ownershipCanonical = `
        CASE
          WHEN ${ownershipBase} IN ('rented','rent','rental','lease','leased','leasing')
            THEN 'rented'
          WHEN ${ownershipBase} IN ('municipality_owned','municipality','municipal','city_owned','city','government','govt','public','owned')
            THEN 'municipality_owned'
          WHEN ${ownershipBase} = '' THEN 'municipality_owned'
          ELSE ${ownershipBase}
        END
      `;
      params.push(ownership);
      filters.push(`(${ownershipCanonical}) = $${params.length}`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM trucks ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * limit;

    const dataParams = params.slice();
    dataParams.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT *
       FROM trucks
       ${whereClause}
       ORDER BY truck_code ASC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    return res.json({
      data: dataResult.rows,
      pagination: {
        page: currentPage,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function getTruckById(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid truck id' });
    }
    const { rows } = await pool.query('SELECT * FROM trucks WHERE id = $1', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Truck not found' });
    }
    return res.json({ data: rows[0] });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function createTruck(req, res) {
  try {
    const { payload, errors } = parseTruckPayload(req.body, { requireFields: true });
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }
    const columns = Object.keys(payload);
    const values = Object.values(payload);
    if (!columns.length) {
      return res.status(400).json({ message: 'No fields provided' });
    }
    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

    const { rows } = await pool.query(
      `INSERT INTO trucks (${columns.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      values
    );
    return res.status(201).json({ data: rows[0], message: 'Truck created' });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function updateTruck(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid truck id' });
    }
    const { payload, errors } = parseTruckPayload(req.body, { requireFields: false });
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }
    const columns = Object.keys(payload);
    if (!columns.length) {
      return res.status(400).json({ message: 'No fields provided' });
    }
    const values = columns.map((col) => payload[col]);
    const assignments = columns.map((col, idx) => `${col} = $${idx + 1}`).join(', ');
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE trucks
       SET ${assignments}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Truck not found' });
    }
    return res.json({ data: rows[0], message: 'Truck updated' });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function deleteTruck(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid truck id' });
    }
    const { rows } = await pool.query('DELETE FROM trucks WHERE id = $1 RETURNING *', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Truck not found' });
    }
    return res.json({ message: 'Truck deleted' });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function getLatestTelemetry(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid truck id' });
    }
    const rows = await queryLatestTelemetry(id);
    return res.json({ data: rows[0] || null });
  } catch (err) {
    return handleDbError(res, err);
  }
}

async function getTelemetryWindow(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Invalid truck id' });
    }
    const minutesRaw = req.query.minutes ?? '60';
    const minutes = Number(minutesRaw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return res.status(400).json({ message: 'minutes must be a positive number' });
    }
    const safeMinutes = Math.min(1440, Math.floor(minutes));

    const rows = await queryTelemetryWindow(id, safeMinutes);
    return res.json({ data: rows });
  } catch (err) {
    return handleDbError(res, err);
  }
}

module.exports = {
  listTrucks,
  getTruckById,
  createTruck,
  updateTruck,
  deleteTruck,
  getLatestTelemetry,
  getTelemetryWindow,
};
