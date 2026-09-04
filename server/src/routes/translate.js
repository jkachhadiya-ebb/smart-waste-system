const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const LOCALES_DIR = path.resolve(__dirname, '..', '..', 'locales');
fs.mkdirSync(LOCALES_DIR, { recursive: true });

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

const MAX_TEXT_LENGTH = 2000;
const DEFAULT_LANGS = new Set(['en', 'de', 'tr']);
const localeCache = new Map();

function normalizeLanguageCode(value) {
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

function getSupportedLanguageCodes() {
  const raw = process.env.SUPPORTED_LANGUAGES || '';
  const list = raw
    .split(',')
    .map((s) => normalizeLanguageCode(s))
    .filter(Boolean);
  if (list.length) return new Set(list);
  return DEFAULT_LANGS;
}

function loadLocale(lang) {
  if (localeCache.has(lang)) return localeCache.get(lang);
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      localeCache.set(lang, parsed);
      return parsed;
    }
  } catch {}
  const empty = {};
  localeCache.set(lang, empty);
  return empty;
}

function saveLocale(lang, data) {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('Failed to write locale file', err?.message || err);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

router.get('/locales/:lang', (req, res) => {
  const lang = normalizeLanguageCode(req.params.lang);
  if (!lang) {
    return res.status(400).json({ message: 'Invalid language' });
  }
  const allowed = getSupportedLanguageCodes();
  if (!allowed.has(lang)) {
    return res.status(404).json({ message: 'Language not available' });
  }
  const data = loadLocale(lang);
  return res.json(data);
});

router.post('/', async (req, res) => {
  const text = String(req.body?.q ?? req.body?.text ?? '').trim();
  if (!text) {
    return res.json({ translatedText: '' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ message: 'Text is too long' });
  }

  const source = normalizeLanguageCode(req.body?.source || 'en') || 'en';
  const target = normalizeLanguageCode(req.body?.target);
  if (!target) {
    return res.status(400).json({ message: 'Target language is required' });
  }

  const allowed = getSupportedLanguageCodes();
  if (!allowed.has(source) || !allowed.has(target)) {
    return res.status(400).json({ message: 'Unsupported language' });
  }

  if (source === target) {
    return res.json({ translatedText: text });
  }

  const cached = loadLocale(target)[text];
  if (typeof cached === 'string' && cached.trim()) {
    return res.json({ translatedText: cached });
  }

  // Proxy translation from server-side to avoid browser CORS blocks.
  try {
    const libreRes = await fetchWithTimeout('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source, target, format: 'text' }),
    });
    if (libreRes.ok) {
      const json = await libreRes.json();
      if (json && typeof json.translatedText === 'string') {
        const store = loadLocale(target);
        store[text] = json.translatedText;
        saveLocale(target, store);
        return res.json({ translatedText: json.translatedText });
      }
    }
  } catch (err) {
    console.warn('LibreTranslate failed', err?.message || err);
  }

  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text);
    url.searchParams.set('langpair', `${source}|${target}`);
    const myMemoryRes = await fetchWithTimeout(url.toString(), {}, 7000);
    if (myMemoryRes.ok) {
      const json = await myMemoryRes.json();
      const match = json?.responseData?.translatedText;
      if (typeof match === 'string') {
        const store = loadLocale(target);
        store[text] = match;
        saveLocale(target, store);
        return res.json({ translatedText: match });
      }
    }
  } catch (err) {
    console.warn('MyMemory failed', err?.message || err);
  }

  return res.status(502).json({ message: 'Translation unavailable' });
});

module.exports = router;
