// Standardized emission factors – single source of truth for the server.
// Factors are per unit of fuel (liters for diesel/petrol, kg for CNG, kWh for electric).

const CO2_FACTORS = {
  diesel:   2.68,   // kg CO2 per liter
  petrol:   2.31,   // kg CO2 per liter
  cng_kg:   2.75,   // kg CO2 per kg CNG
  cng_m3:   1.98,   // kg CO2 per m³ CNG
  cng:      2.75,   // default CNG assumes kg
  electric: 0,      // tank-to-wheel
  hybrid:   2.31,   // default to petrol factor; adjust with combustion_share
};

const CO_FACTORS = {
  diesel:   0.004,  // kg CO per liter
  petrol:   0.006,  // kg CO per liter
  cng:      0.004,
  cng_kg:   0.004,
  cng_m3:   0.003,
  electric: 0,
  hybrid:   0.006,
};

// CO2e = CO2 + CO * 3.0 (CO has ~3x GWP when oxidised to CO2 over short horizon)
const CO_TO_CO2E_FACTOR = 3.0;

// TCRE warming constant
const TCRE_C_PER_KG = 4.5e-16;

// Carbon tax (German BEHG 2025 default, overridable via env)
function getCarbonTaxEurPerTonne() {
  const envVal = Number(process.env.CO2_TAX_EUR_PER_TONNE);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 55;
}

function getCo2Factor(fuelType) {
  return CO2_FACTORS[fuelType] ?? CO2_FACTORS.diesel;
}

function getCoFactor(fuelType) {
  return CO_FACTORS[fuelType] ?? CO_FACTORS.diesel;
}

/**
 * Calculate CO2 from fuel consumption.
 * @param {number} fuelQuantity - Amount of fuel consumed
 * @param {string} fuelType - Type of fuel
 * @returns {number} CO2 in kg
 */
function calcCo2FromFuel(fuelQuantity, fuelType = 'diesel') {
  const factor = getCo2Factor(fuelType);
  return fuelQuantity * factor;
}

/**
 * Calculate CO from fuel consumption using per-fuel factors.
 * NOT using CO = CO2 * 0.02 any more.
 * @param {number} fuelQuantity - Amount of fuel consumed
 * @param {string} fuelType - Type of fuel
 * @returns {number} CO in kg
 */
function calcCoFromFuel(fuelQuantity, fuelType = 'diesel') {
  const factor = getCoFactor(fuelType);
  return fuelQuantity * factor;
}

/**
 * @deprecated Use calcCoFromFuel instead. Kept for backward compat during transition.
 * Now returns a more accurate estimate using typical CO/CO2 ratio per fuel type.
 */
function calcCoFromCo2(co2Kg, fuelType = 'diesel') {
  // Approximate CO from CO2 using ratio of per-fuel factors
  const co2Factor = getCo2Factor(fuelType);
  const coFactor = getCoFactor(fuelType);
  if (co2Factor <= 0) return 0;
  return co2Kg * (coFactor / co2Factor);
}

/**
 * CO2-equivalent: CO2 + CO * 3.0
 */
function carbonFootprintKg(co2Kg, coKg) {
  return co2Kg + coKg * CO_TO_CO2E_FACTOR;
}

module.exports = {
  CO2_FACTORS,
  CO_FACTORS,
  CO_TO_CO2E_FACTOR,
  TCRE_C_PER_KG,
  getCarbonTaxEurPerTonne,
  getCo2Factor,
  getCoFactor,
  calcCo2FromFuel,
  calcCoFromFuel,
  calcCoFromCo2,
  carbonFootprintKg,
};