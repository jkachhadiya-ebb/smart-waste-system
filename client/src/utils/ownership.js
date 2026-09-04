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

export function normalizeOwnershipType(value, { fallback = '' } = {}) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.replace(/[\s-]+/g, '_');
  return OWNERSHIP_ALIASES[normalized] || fallback || normalized;
}
