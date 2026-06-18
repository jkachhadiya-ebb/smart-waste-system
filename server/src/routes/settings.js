const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const { z } = require('zod');
const pool = require('../db');
const auth = require('../authMiddleware');
const { encrypt, decrypt } = require('../services/encryption');

const router = express.Router();

const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const userSettingKeys = [
  'theme',
  'language',
  'map_view',
  'zoom',
  'marker_style',
  'show_registered_cities',
  'show_recycling_centers',
  'show_trucks_live',
];

const pendingTotpSecrets = new Map();
const TOTP_SETUP_TTL_MS = 5 * 60 * 1000;
let cachedIntlLanguages = null;
let cachedLanguageDisplay = null;
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

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emitMunicipalityUpdate(req, changedFields) {
  const io = req.app.get('io');
  if (!io) return;
  io.emit('municipalitySettingsUpdated', {
    municipality_id: req.user.municipality_id,
    changedFields,
  });
}

function emitUserSettingsUpdate(req, changedFields) {
  const io = req.app.get('io');
  if (!io) return;
  io.emit('userSettingsUpdated', {
    user_id: req.user.id,
    changedFields,
  });
}

function buildEffectiveValues(userSettings, municipalitySettings) {
  const defaults = {
    theme: 'system',
    language: 'en',
    map_view: 'municipality',
    zoom: 12,
    marker_style: 'icons',
    show_registered_cities: true,
    show_recycling_centers: true,
    show_trucks_live: true,
  };
  const userLanguage = normalizeLanguageCode(userSettings.language);
  const municipalityLanguage = normalizeLanguageCode(municipalitySettings.default_language);
  return {
    theme: userSettings.theme ?? municipalitySettings.default_theme ?? defaults.theme,
    language: userLanguage || municipalityLanguage || defaults.language,
    map_view: userSettings.map_view ?? municipalitySettings.default_map_view ?? defaults.map_view,
    zoom: Number(
      userSettings.zoom ?? municipalitySettings.default_zoom ?? defaults.zoom
    ),
    marker_style:
      userSettings.marker_style ?? municipalitySettings.marker_style ?? defaults.marker_style,
    show_registered_cities:
      userSettings.show_registered_cities ?? municipalitySettings.show_registered_cities ?? defaults.show_registered_cities,
    show_recycling_centers:
      userSettings.show_recycling_centers ?? municipalitySettings.show_recycling_centers ?? defaults.show_recycling_centers,
    show_trucks_live:
      userSettings.show_trucks_live ?? municipalitySettings.show_trucks_live ?? defaults.show_trucks_live,
  };
}

function getBaseUrl(req) {
  const host = req.get('host');
  if (!host) return '';
  return `${req.protocol}://${host}`;
}

function cleanNotificationPrefs(prefs, eventKeys) {
  const map = {};
  for (const { event_key: key } of eventKeys) {
    if (typeof prefs[key] === 'boolean') {
      map[key] = prefs[key];
    } else {
      map[key] = true;
    }
  }
  return map;
}

function getLanguageDisplay() {
  if (cachedLanguageDisplay !== null) return cachedLanguageDisplay;
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
    cachedLanguageDisplay = undefined;
    return cachedLanguageDisplay;
  }
  cachedLanguageDisplay = new Intl.DisplayNames(['en'], { type: 'language' });
  return cachedLanguageDisplay;
}

function canonicalizeLanguage(value) {
  if (!value) return '';
  const normalized = String(value).replace('_', '-');
  if (typeof Intl === 'undefined' || typeof Intl.getCanonicalLocales !== 'function') {
    return normalized;
  }
  try {
    return Intl.getCanonicalLocales(normalized)[0] || normalized;
  } catch {
    return normalized;
  }
}

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

function resolveLanguageLabel(code, label) {
  if (!code) return '';
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (trimmed && trimmed.toLowerCase() !== String(code).toLowerCase()) {
    return trimmed;
  }
  const display = getLanguageDisplay();
  if (!display) return String(code);
  const canonical = canonicalizeLanguage(code);
  return display.of(canonical) || display.of(code) || canonical || String(code);
}

// Supported languages come from environment (comma-separated), e.g. SUPPORTED_LANGUAGES=en,de,tr
function getSupportedLanguageCodes() {
  const raw = process.env.SUPPORTED_LANGUAGES || '';
  const list = raw
    .split(',')
    .map((s) => normalizeLanguageCode(s))
    .filter(Boolean);
  return Array.from(new Set(list));
}
let SUPPORTED_LANGUAGE_CODES = getSupportedLanguageCodes();

function getIntlLanguages() {
  if (cachedIntlLanguages) return cachedIntlLanguages;
  // If env is set, use it; otherwise fallback to DB or empty
  if (SUPPORTED_LANGUAGE_CODES && SUPPORTED_LANGUAGE_CODES.length) {
    cachedIntlLanguages = SUPPORTED_LANGUAGE_CODES
      .map((code) => ({ code, label: resolveLanguageLabel(code) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
    return cachedIntlLanguages;
  }
  cachedIntlLanguages = [];
  return cachedIntlLanguages;
}

router.get('/profile', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, municipality_code, country, state_region, city,
         address_text, address_lat, address_lng, contact_email,
         contact_phone, logo_url
       FROM municipalities
       WHERE id = $1`,
      [req.user.municipality_id]
    );

    if (!result.rows.length) {
      return res.json({
        municipality: null,
        canEdit: req.user.role === 'admin',
        message: 'Municipality profile unavailable',
      });
    }

    res.json({
      municipality: result.rows[0],
      canEdit: req.user.role === 'admin',
    });
  } catch (err) {
    console.error('Profile load failed', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/profile', auth, async (req, res) => {

  const updateFields = {};

  if (req.body.address_text !== undefined) {
    const text = String(req.body.address_text || '').trim();
    if (text && text.length > 255) {
      return res.status(400).json({ message: 'Address too long' });
    }
    updateFields.address_text = text || null;
  }

  if (req.body.address_lat !== undefined) {
    const lat = parseNumber(req.body.address_lat);
    if (lat === null) {
      updateFields.address_lat = null;
    } else {
      if (lat < -90 || lat > 90) {
        return res.status(400).json({ message: 'Invalid latitude' });
      }
      updateFields.address_lat = lat;
    }
  }

  if (req.body.address_lng !== undefined) {
    const lng = parseNumber(req.body.address_lng);
    if (lng === null) {
      updateFields.address_lng = null;
    } else {
      if (lng < -180 || lng > 180) {
        return res.status(400).json({ message: 'Invalid longitude' });
      }
      updateFields.address_lng = lng;
    }
  }

  if (req.body.contact_email !== undefined) {
    const email = String(req.body.contact_email ?? '').trim().toLowerCase();
    if (!email) {
      updateFields.contact_email = null;
    } else {
      const parsed = z.string().email().safeParse(email);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid email' });
      }
      updateFields.contact_email = email;
    }
  }

  if (req.body.contact_phone !== undefined) {
    const phone = String(req.body.contact_phone ?? '').trim();
    if (!phone) {
      updateFields.contact_phone = null;
    } else {
      if (phone.length < 7 || phone.length > 24) {
        return res.status(400).json({ message: 'Phone must be 7-24 characters' });
      }
      updateFields.contact_phone = phone;
    }
  }

  if (req.body.logo_url !== undefined) {
    const logoUrl = String(req.body.logo_url || '');
    if (logoUrl) {
      const parsed = z.string().url().safeParse(logoUrl);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid logo URL' });
      }
      updateFields.logo_url = logoUrl;
    } else {
      updateFields.logo_url = null;
    }
  }

  if (!Object.keys(updateFields).length) {
    return res.status(400).json({ message: 'Nothing to update' });
  }

  try {
    const columns = Object.keys(updateFields);
    const assignments = columns
      .map((col, idx) => `${col} = $${idx + 2}`)
      .join(', ');
    const values = [req.user.municipality_id, ...columns.map((col) => updateFields[col])];

    await pool.query(
      `UPDATE municipalities SET ${assignments} WHERE id = $1`,
      values
    );

    const updated = await pool.query(
      `SELECT id, name, municipality_code, country, state_region, city,
              address_text, address_lat, address_lng, contact_email,
              contact_phone, logo_url
       FROM municipalities WHERE id = $1`,
      [req.user.municipality_id]
    );

    emitMunicipalityUpdate(req, updateFields);

    res.json({ municipality: updated.rows[0], message: 'Municipality saved' });
  } catch (err) {
    console.error('Profile save failed', err);
    res.status(500).json({ message: 'Could not save contact info' });
  }
});

router.post('/profile/logo', auth, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Logo file is required' });
    }
    const baseUrl = getBaseUrl(req);
    const url = `${baseUrl}/uploads/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    console.error('Logo upload error', err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

router.get('/general', auth, async (req, res) => {
  try {
    const [userResult, municipalityResult] = await Promise.all([
      pool.query('SELECT * FROM user_settings WHERE user_id = $1', [req.user.id]),
      pool.query('SELECT * FROM municipality_settings WHERE municipality_id = $1', [req.user.municipality_id]),
    ]);

    const userSettings = userResult.rows[0] || {};
    const municipalitySettings = municipalityResult.rows[0] || {};
    const normalizedUserSettings = { ...userSettings };
    if (normalizedUserSettings.language !== undefined && normalizedUserSettings.language !== null) {
      normalizedUserSettings.language = normalizeLanguageCode(normalizedUserSettings.language) || null;
    }
    const normalizedMunicipalitySettings = { ...municipalitySettings };
    if (
      normalizedMunicipalitySettings.default_language !== undefined &&
      normalizedMunicipalitySettings.default_language !== null
    ) {
      normalizedMunicipalitySettings.default_language =
        normalizeLanguageCode(normalizedMunicipalitySettings.default_language) || null;
    }
    const effective = buildEffectiveValues(normalizedUserSettings, normalizedMunicipalitySettings);

    res.json({
      userSettings: normalizedUserSettings,
      municipalitySettings: normalizedMunicipalitySettings,
      effective,
      isAdmin: req.user.role === 'admin',
      municipality_id: req.user.municipality_id,
    });
  } catch (err) {
    console.error('General settings load failed', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/languages', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT code, label
       FROM supported_languages
       WHERE enabled = TRUE
       ORDER BY sort_order ASC, label ASC`
    );
    const languageMap = new Map();
    result.rows.forEach((row) => {
      const code = normalizeLanguageCode(row.code);
      if (!code || languageMap.has(code)) return;
      languageMap.set(code, resolveLanguageLabel(code, row.label));
    });
    let languages = Array.from(languageMap, ([code, label]) => ({ code, label }));

    // If env restricts languages, filter accordingly
    SUPPORTED_LANGUAGE_CODES = getSupportedLanguageCodes();
    if (SUPPORTED_LANGUAGE_CODES && SUPPORTED_LANGUAGE_CODES.length) {
      const allowed = new Set(SUPPORTED_LANGUAGE_CODES);
      languages = languages.filter((l) => allowed.has(l.code));
    }

    if (!languages.length) {
      const fallback = getIntlLanguages();
      return res.json({ languages: fallback });
    }

    return res.json({ languages });
  } catch (err) {
    if (err.code === '42P01') {
      const fallback = getIntlLanguages();
      return res.json({ languages: fallback });
    }
    console.error('Language list failed', err);
    res.status(500).json({ message: 'Could not load languages' });
  }
});
 
router.post('/general', auth, async (req, res) => {
  const schema = z.object({
    theme: z.enum(['light', 'dark', 'system']).nullable().optional(),
    language: z
      .string()
      .min(1)
      .max(35)
      .nullable()
      .optional()
      .refine((value) => {
        if (value === null || value === undefined) return true;
        const allowed = getSupportedLanguageCodes();
        const normalized = normalizeLanguageCode(value);
        return !allowed.length || (normalized && allowed.includes(normalized));
      }, { message: 'Unsupported language' }),
    map_view: z.enum(['city', 'municipality']).nullable().optional(),
    zoom: z
      .union([z.number(), z.string()])
      .transform((value) => parseNumber(value))
      .nullable()
      .optional(),
    marker_style: z.enum(['icons', 'labels']).nullable().optional(),
    show_registered_cities: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
    show_recycling_centers: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
    show_trucks_live: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid general settings payload' });
  }

  const data = parsed.data;
  if (data.language !== undefined && data.language !== null) {
    const normalized = normalizeLanguageCode(data.language);
    if (normalized) {
      data.language = normalized;
    }
  }
  const providedKeys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (!providedKeys.length) {
    return res.status(400).json({ message: 'No general settings provided' });
  }

  const columns = ['user_id', ...providedKeys];
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  const values = [req.user.id, ...providedKeys.map((key) => data[key])];

  const updates = providedKeys.map((key) => `${key} = EXCLUDED.${key}`).join(', ');

  try {
    await pool.query(
      `INSERT INTO user_settings (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
      values
    );

    emitUserSettingsUpdate(req, data);
    res.json({ message: 'Preferences saved' });
  } catch (err) {
    console.error('General save failed', err);
    res.status(500).json({ message: 'Could not save preferences' });
  }
});

router.post('/general/reset', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_settings
       SET theme = NULL,
           language = NULL,
           map_view = NULL,
           zoom = NULL,
           marker_style = NULL,
           show_registered_cities = NULL,
           show_recycling_centers = NULL,
           show_trucks_live = NULL
       WHERE user_id = $1`,
      [req.user.id]
    );

    const cleared = userSettingKeys.reduce((acc, key) => ({ ...acc, [key]: null }), {});
    emitUserSettingsUpdate(req, cleared);

    res.json({ message: 'Reset to defaults' });
  } catch (err) {
    console.error('General reset failed', err);
    res.status(500).json({ message: 'Could not reset preferences' });
  }
});

router.post('/general/municipality-defaults', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admins only' });
  }

  const schema = z.object({
    default_theme: z.enum(['light', 'dark', 'system']).nullable().optional(),
    default_language: z
      .string()
      .min(1)
      .max(35)
      .nullable()
      .optional()
      .refine((value) => {
        if (value === null || value === undefined) return true;
        const allowed = getSupportedLanguageCodes();
        const normalized = normalizeLanguageCode(value);
        return !allowed.length || (normalized && allowed.includes(normalized));
      }, { message: 'Unsupported language' }),
    default_map_view: z.enum(['city', 'municipality']).nullable().optional(),
    default_zoom: z
      .union([z.number(), z.string()])
      .transform((value) => parseNumber(value))
      .nullable()
      .optional(),
    marker_style: z.enum(['icons', 'labels']).nullable().optional(),
    show_registered_cities: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
    show_recycling_centers: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
    show_trucks_live: z
      .union([z.boolean(), z.string()])
      .transform((value) => parseBoolean(value))
      .nullable()
      .optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid defaults payload' });
  }

  const data = parsed.data;
  if (data.default_language !== undefined && data.default_language !== null) {
    const normalized = normalizeLanguageCode(data.default_language);
    if (normalized) {
      data.default_language = normalized;
    }
  }
  const providedKeys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (!providedKeys.length) {
    return res.status(400).json({ message: 'No defaults provided' });
  }

  const columns = ['municipality_id', ...providedKeys];
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  const values = [req.user.municipality_id, ...providedKeys.map((key) => data[key])];
  const updates = providedKeys.map((key) => `${key} = EXCLUDED.${key}`).join(', ');

  try {
    await pool.query(
      `INSERT INTO municipality_settings (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (municipality_id) DO UPDATE SET ${updates}`,
      values
    );

    const changedFields = providedKeys.reduce((acc, key) => ({ ...acc, [key]: data[key] }), {});
    emitMunicipalityUpdate(req, changedFields);

    res.json({ message: 'Organization defaults updated' });
  } catch (err) {
    console.error('Municipality defaults save failed', err);
    res.status(500).json({ message: 'Could not save defaults' });
  }
});
router.get('/notifications', auth, async (req, res) => {
  try {
    const [channelResult, eventResult, prefsResult] = await Promise.all([
      pool.query('SELECT * FROM user_notification_settings WHERE user_id = $1', [req.user.id]),
      pool.query('SELECT key, label FROM notification_event_types ORDER BY label'),
      pool.query('SELECT event_key, enabled FROM user_notification_event_prefs WHERE user_id = $1', [req.user.id]),
    ]);

    const channels = channelResult.rows[0] || {
      email_enabled: true,
      sms_enabled: false,
      inapp_enabled: false,
      gps_offline_minutes: 15,
    };

    const eventTypes = eventResult.rows;
    const prefs = {};
    for (const { event_key, enabled } of prefsResult.rows) {
      prefs[event_key] = enabled;
    }

    const normalized = cleanNotificationPrefs(prefs, eventTypes);

    res.json({
      channels,
      eventTypes,
      prefs: normalized,
      gps_offline_minutes: channels.gps_offline_minutes,
    });
  } catch (err) {
    console.error('Notifications load failed', err);
    res.status(500).json({ message: 'Could not load notifications' });
  }
});

router.post('/notifications', auth, async (req, res) => {
  const channelsSchema = z.object({
    email_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    inapp_enabled: z.boolean().optional(),
    gps_offline_minutes: z
      .union([z.number(), z.string()])
      .transform((value) => parseNumber(value))
      .nullable()
      .optional(),
  });

  const prefsSchema = z
    .array(
      z.object({
        event_key: z.string(),
        enabled: z.boolean(),
      })
    )
    .optional();

  const channelParse = channelsSchema.safeParse(req.body.channels || {});
  if (!channelParse.success) {
    return res.status(400).json({ message: 'Invalid channel payload' });
  }

  const prefParse = prefsSchema.safeParse(req.body.eventPrefs || []);
  if (!prefParse.success) {
    return res.status(400).json({ message: 'Invalid event preferences' });
  }

  try {
    const eventTypes = await pool.query('SELECT key FROM notification_event_types');
    const eventKeys = eventTypes.rows.map((row) => row.key);

    const prefsMap = prefParse.data.reduce((acc, pref) => {
      if (eventKeys.includes(pref.event_key)) {
        acc[pref.event_key] = pref.enabled;
      }
      return acc;
    }, {});

    const normalizedPrefs = eventKeys.map((key) => ({
      event_key: key,
      enabled: prefsMap[key] ?? true,
    }));

    const channelKeys = Object.keys(channelParse.data);
    if (channelKeys.length) {
      const columns = ['user_id', ...channelKeys];
      const placeholders = columns.map((_, idx) => `$${idx + 1}`);
      const values = [req.user.id, ...channelKeys.map((key) => channelParse.data[key])];
      const updates = channelKeys.map((key) => `${key} = EXCLUDED.${key}`).join(', ');

      await pool.query(
        `INSERT INTO user_notification_settings (${columns.join(', ')})
         VALUES (${placeholders.join(', ')})
         ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
        values
      );
    }

    const prefValues = normalizedPrefs.map((pref) => [req.user.id, pref.event_key, pref.enabled]);
    const prefInsertPromises = prefValues.map(([userId, key, enabled]) =>
      pool.query(
        `INSERT INTO user_notification_event_prefs (user_id, event_key, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, event_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [userId, key, enabled]
      )
    );

    await Promise.all(prefInsertPromises);

    res.json({ message: 'Notifications saved' });
  } catch (err) {
    console.error('Notifications save failed', err);
    res.status(500).json({ message: 'Could not save notifications' });
  }
});

router.get('/security/sessions', auth, async (req, res) => {
  try {
    const [sessionsResult, mfaResult] = await Promise.all([
      pool.query(
        `SELECT id, ip_address, user_agent, created_at, last_seen_at
         FROM user_sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [req.user.id]
      ),
      pool.query('SELECT totp_enabled FROM user_mfa WHERE user_id = $1', [req.user.id]),
    ]);

    res.json({
      sessions: sessionsResult.rows,
      currentSessionId: req.user.sessionId,
      mfaEnabled: Boolean(mfaResult.rows[0]?.totp_enabled),
    });
  } catch (err) {
    console.error('Session list failed', err);
    res.status(500).json({ message: 'Could not list sessions' });
  }
});

router.post('/security/logout-this', auth, async (req, res) => {
  if (!req.user.sessionId) {
    return res.status(400).json({ message: 'Current session not tracked' });
  }

  try {
    await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [req.user.sessionId, req.user.id]
    );
    res.json({ message: 'Session revoked' });
  } catch (err) {
    console.error('Logout this failed', err);
    res.status(500).json({ message: 'Could not revoke session' });
  }
});

router.post('/security/logout-all', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user.id]
    );

    res.json({ message: 'Logged out from every session' });
  } catch (err) {
    console.error('Logout all failed', err);
    res.status(500).json({ message: 'Could not revoke sessions' });
  }
});

router.post('/security/change-password', auth, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    logoutAllOtherDevices: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid password payload' });
  }

  try {
    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const stored = userResult.rows[0];
    if (!stored) {
      return res.status(404).json({ message: 'User not found' });
    }

    const matches = await bcrypt.compare(parsed.data.currentPassword, stored.password_hash);
    if (!matches) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    if (parsed.data.logoutAllOtherDevices) {
      await pool.query(
        `UPDATE user_sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.user.id]
      );
      return res.json({ message: 'Password updated and all sessions revoked' });
    }

    if (req.user.sessionId) {
      await pool.query(
        `UPDATE user_sessions
         SET revoked_at = NOW()
         WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL`,
        [req.user.id, req.user.sessionId]
      );
    }

    res.json({ message: 'Password updated' });
  } catch (err) {
    console.error('Change password failed', err);
    res.status(500).json({ message: 'Could not change password' });
  }
});

router.get('/security/2fa/setup', auth, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ length: 20 });
    const expiresAt = Date.now() + TOTP_SETUP_TTL_MS;
    pendingTotpSecrets.set(req.user.id, { secret: secret.base32, expiresAt });

    const otpauth = speakeasy.otpauthURL({
      secret: secret.base32,
      label: `Smart Waste (${req.user.username || 'user'})`,
      issuer: 'Smart Waste',
      encoding: 'base32',
    });

    const masked = secret.base32.replace(/.(?=.{4})/g, '*');

    res.json({ otpauth_uri: otpauth, secret_masked: masked });
  } catch (err) {
    console.error('2FA setup failed', err);
    res.status(500).json({ message: 'Could not generate QR code' });
  }
});

router.post('/security/2fa/verify', auth, async (req, res) => {
  const schema = z.object({ code: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Code is required' });
  }

  const pending = pendingTotpSecrets.get(req.user.id);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingTotpSecrets.delete(req.user.id);
    return res.status(400).json({ message: 'Setup expired, try again' });
  }

  const verified = speakeasy.totp.verify({
    secret: pending.secret,
    encoding: 'base32',
    token: parsed.data.code,
    window: 1,
  });

  if (!verified) {
    return res.status(400).json({ message: 'Invalid verification code' });
  }

  const encrypted = encrypt(pending.secret);
  if (!encrypted) {
    return res.status(500).json({ message: 'Could not encrypt secret' });
  }

  try {
    await pool.query(
      `INSERT INTO user_mfa (user_id, totp_enabled, totp_secret_encrypted, enabled_at, updated_at)
       VALUES ($1, TRUE, $2, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET totp_enabled = TRUE,
             totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
             enabled_at = EXCLUDED.enabled_at,
             updated_at = EXCLUDED.updated_at`,
      [req.user.id, encrypted]
    );
    pendingTotpSecrets.delete(req.user.id);

    res.json({ message: '2FA enabled' });
  } catch (err) {
    console.error('2FA verify failed', err);
    res.status(500).json({ message: 'Could not enable 2FA' });
  }
});

router.post('/security/2fa/disable', auth, async (req, res) => {
  const schema = z.object({
    code: z.string().regex(/^\d{6}$/).optional(),
    password: z.string().min(1).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Disable payload invalid' });
  }

  try {
    const mfaResult = await pool.query('SELECT totp_enabled, totp_secret_encrypted FROM user_mfa WHERE user_id = $1', [req.user.id]);
    const mfaRow = mfaResult.rows[0];
    if (!mfaRow || !mfaRow.totp_enabled) {
      return res.status(400).json({ message: '2FA is not enabled for this account' });
    }

    let verified = false;
    let secret = null;
    if (mfaRow.totp_secret_encrypted) {
      secret = decrypt(mfaRow.totp_secret_encrypted);
    }

    if (parsed.data.code && secret) {
      verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: parsed.data.code,
        window: 1,
      });
    }

    if (!verified && parsed.data.password) {
      const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const userRow = userResult.rows[0];
      if (userRow) {
        verified = await bcrypt.compare(parsed.data.password, userRow.password_hash);
      }
    }

    if (!verified) {
      return res.status(400).json({ message: 'Code or password invalid' });
    }

    await pool.query(
      `UPDATE user_mfa
       SET totp_enabled = FALSE,
           totp_secret_encrypted = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({ message: '2FA disabled' });
  } catch (err) {
    console.error('Disable 2FA failed', err);
    res.status(500).json({ message: 'Could not disable 2FA' });
  }
});

module.exports = router;
