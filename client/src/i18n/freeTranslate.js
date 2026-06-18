// Simple wrapper for a free translation API (LibreTranslate)
// Falls back to MyMemory if LibreTranslate fails

function getApiBaseUrl() {
  const envBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : null;
  return envBase || 'http://localhost:5000/api';
}

async function translateViaBackend(q, source, target) {
  try {
    const res = await fetch(`${getApiBaseUrl()}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, source, target }),
    });
    if (!res.ok) return '';
    const json = await res.json();
    return typeof json?.translatedText === 'string' ? json.translatedText : '';
  } catch (err) {
    console.warn('Backend translation failed', err);
    return '';
  }
}

export async function translateFree(text, source = 'en', target = 'de') {
  const q = String(text || '').trim();
  if (!q) return '';

  const fromBackend = await translateViaBackend(q, source, target);
  if (fromBackend) return fromBackend;

  // Try LibreTranslate directly
  try {
    const res = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, source, target, format: 'text' }),
    });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json.translatedText === 'string') {
        return json.translatedText;
      }
    }
  } catch (err) {
    console.warn('LibreTranslate request failed', err);
  }

  // Fallback to MyMemory free API
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', q);
    url.searchParams.set('langpair', `${source}|${target}`);
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      const match = json?.responseData?.translatedText;
      if (typeof match === 'string') return match;
    }
  } catch (err) {
    console.warn('MyMemory translation failed', err);
  }

  // As a last resort, return original text
  return q;
}
