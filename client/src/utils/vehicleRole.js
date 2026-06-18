const ROLE_ALIASES = {
  waste_truck: 'waste_truck',
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
  wastetruck: 'waste_truck',
};

export function normalizeVehicleRole(value, { fallback = '' } = {}) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(/[\s-]+/g, '_');
  return ROLE_ALIASES[normalized] || fallback || normalized;
}

export function resolveVehicleRoleFromTruck(truck) {
  const normalized = normalizeVehicleRole(truck?.vehicle_role, { fallback: '' });
  if (normalized) return normalized;
  const text = `${truck?.model || ''} ${truck?.truck_code || ''}`.toLowerCase();
  if (text.includes('support') || text.includes('car') || text.includes('van')) {
    return 'support_car';
  }
  return 'waste_truck';
}
