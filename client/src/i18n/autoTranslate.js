import i18next from 'i18next';
import { translateFree } from './freeTranslate';
import { normalizeLanguageCode } from './normalizeLanguage';

const STORAGE_KEY = 'i18n_auto_cache_v1';
const failedInSession = new Set();
const inFlight = new Map();
const queue = [];
const MAX_CONCURRENCY = 2;
let active = 0;

export function resetFailedTranslations() {
  failedInSession.clear();
}

function runQueue() {
  while (active < MAX_CONCURRENCY && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runQueue();
      });
  }
}

function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    runQueue();
  });
}

function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to save translation cache', err);
  }
}

const cache = loadCache();

export async function getTranslationFor(language, key, defaultValue = '') {
  const lang = normalizeLanguageCode(language);
  const k = String(key || '').trim();
  if (!lang || !k) return defaultValue || k;

  // English is our source; no translation needed
  if (lang === 'en') return defaultValue || k;

  const sourceText = defaultValue || k;
  cache[lang] = cache[lang] || {};
  if (cache[lang][k]) {
    if (cache[lang][k] === sourceText) {
      delete cache[lang][k];
      saveCache(cache);
    } else {
      i18next.addResource(lang, 'app', k, cache[lang][k]);
      return cache[lang][k];
    }
  }

  const failureKey = `${lang}:${k}`;
  if (failedInSession.has(failureKey)) return sourceText;
  if (inFlight.has(failureKey)) {
    return inFlight.get(failureKey);
  }

  const task = async () => {
    const translated = await translateFree(sourceText, 'en', lang);
    const finalText = translated || sourceText;

    // Add into i18next resource bundle so subsequent lookups are instant
    i18next.addResource(lang, 'app', k, finalText);
    if (translated && translated !== sourceText) {
      cache[lang][k] = finalText;
      saveCache(cache);
    } else {
      failedInSession.add(failureKey);
    }
    return finalText;
  };

  const promise = schedule(task).finally(() => {
    inFlight.delete(failureKey);
  });
  inFlight.set(failureKey, promise);
  return promise;
}

export async function ensureNamespace(language) {
  const lang = normalizeLanguageCode(language);
  if (!lang) return;
  if (!i18next.hasResourceBundle(lang, 'app')) {
    i18next.addResourceBundle(lang, 'app', {}, true, true);
  }
}
