/**
 * @typedef {Object} EmissionsPoint
 * @property {string} bucket
 * @property {number} co2_kg
 * @property {number} co_kg
 * @property {number} co2e_kg
 * @property {number} tax_instant_eur
 * @property {number} tax_cumulative_eur
 * @property {number} warming_c
 * @property {number} warming_nano_c
 * @property {number} warming_pico_c
 */

/**
 * @typedef {Object} EmissionsTotals
 * @property {number} co2e_kg_total
 * @property {number} tax_total_eur
 * @property {number} warming_c_latest
 * @property {number} warming_nano_c_latest
 * @property {number} warming_pico_c_latest
 */

/**
 * @typedef {Object} EmissionsDataset
 * @property {number|null} municipality_id
 * @property {EmissionsPoint[]} points
 * @property {EmissionsTotals} totals
 */

/**
 * @typedef {Object} ReportsEmissionsResponse
 * @property {string} range
 * @property {boolean} live
 * @property {string} generated_at
 * @property {EmissionsDataset} primary
 * @property {EmissionsDataset|null} compareA
 * @property {EmissionsDataset|null} compareB
 */

/**
 * @typedef {Object} MunicipalityOption
 * @property {number} id
 * @property {string|null} name
 * @property {string|null} municipality_code
 * @property {string|null} city
 * @property {string|null} state_region
 */

export {};
