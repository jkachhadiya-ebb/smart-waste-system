const LANGUAGE_ALIASES = new Map([
  ['english', 'en'],
  ['en', 'en'],
  ['german', 'de'],
  ['deutsch', 'de'],
  ['de', 'de'],
  ['turkish', 'tr'],
  ['turkce', 'tr'],
  ['tr', 'tr'],
]);

export function normalizeLanguageCode(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const normalized = raw.replace(/_/g, '-');
  const cleaned =
    typeof normalized.normalize === 'function'
      ? normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      : normalized;
  const lowered = cleaned.toLowerCase();

  if (LANGUAGE_ALIASES.has(lowered)) {
    return LANGUAGE_ALIASES.get(lowered);
  }

  const base = lowered.split('-')[0];
  if (LANGUAGE_ALIASES.has(base)) {
    return LANGUAGE_ALIASES.get(base);
  }

  return base.slice(0, 2);
}