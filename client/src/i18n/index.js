import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { ensureNamespace, getTranslationFor, resetFailedTranslations } from './autoTranslate';
import { normalizeLanguageCode } from './normalizeLanguage';

function getApiBaseUrl() {
  const envBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : null;
  return envBase || 'http://localhost:5000/api';
}

const loadedLocalBundles = new Set();

async function loadLocalBundle(language) {
  const lang = normalizeLanguageCode(language);
  if (!lang || loadedLocalBundles.has(lang)) return;
  try {
    const res = await fetch(`${getApiBaseUrl()}/translate/locales/${lang}`);
    if (!res.ok) return;
    const json = await res.json();
    if (json && typeof json === 'object') {
      i18next.addResourceBundle(lang, 'app', json, true, true);
      loadedLocalBundles.add(lang);
    }
  } catch (err) {
    console.warn('Failed to load local translation bundle', err);
  }
}

async function fetchSupportedLanguages() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${getApiBaseUrl()}/settings/languages`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return ['en', 'de', 'tr'];
    const json = await res.json();
    const codes = (json?.languages || [])
      .map((l) => normalizeLanguageCode(l?.code ?? l))
      .filter(Boolean);
    const unique = Array.from(new Set(codes));
    return unique.length ? unique : ['en', 'de', 'tr'];
  } catch {
    return ['en', 'de', 'tr'];
  }
}

export async function initI18n() {
  const supportedLngs = await fetchSupportedLanguages();

  await i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
      fallbackLng: 'en',
      supportedLngs,
      ns: ['app'],
      defaultNS: 'app',
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      react: { bindI18nStore: 'added' },
      saveMissing: true,
      saveMissingTo: 'current',
      missingKeyHandler: async (lng, ns, key) => {
        const targets = Array.isArray(lng) ? lng : [lng];
        const normalizedTargets = Array.from(
          new Set(targets.map((target) => normalizeLanguageCode(target)).filter(Boolean))
        );
        await Promise.all(
          normalizedTargets.map(async (target) => {
            await ensureNamespace(target);
            await getTranslationFor(target, key, key);
          })
        );
      },
    });

  const current = normalizeLanguageCode(i18next.language || 'en') || 'en';
  await ensureNamespace(current);
  await loadLocalBundle(current);
  if (i18next.language !== current) {
    await i18next.changeLanguage(current);
  }
  i18next.on('languageChanged', (lng) => {
    resetFailedTranslations();
    loadLocalBundle(lng);
  });
}

export default i18next;
