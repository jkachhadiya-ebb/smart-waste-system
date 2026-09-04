import { useCallback, useEffect, useMemo, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import useDirtyGuard from '../../hooks/useDirtyGuard';
import {
  fetchGeneral,
  fetchLanguages,
  resetGeneralSettings,
  saveGeneralSettings,
} from '../../api/settingsApi.js';
import { subscribeToSettings } from '../../socket/settingsSocket.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import { normalizeLanguageCode } from '../../i18n/normalizeLanguage.js';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const MAP_VIEWS = [
  { value: 'city', label: 'City view' },
  { value: 'municipality', label: 'Municipality view' },
];

const MARKER_STYLES = [
  { value: 'icons', label: 'Icons' },
  { value: 'labels', label: 'Labels' },
];

const languageDisplayCache = new Map();

function getLanguageDisplay(locale) {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
    return null;
  }
  const key = locale || 'en';
  if (!languageDisplayCache.has(key)) {
    languageDisplayCache.set(key, new Intl.DisplayNames([key], { type: 'language' }));
  }
  return languageDisplayCache.get(key);
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

function formatLanguageLabel(value, label, display, translate) {
  if (!value) return '';
  const raw = String(value);
  const canonical = canonicalizeLanguage(raw);
  if (display) {
    const displayLabel = display.of(canonical) || display.of(raw);
    if (displayLabel) return displayLabel;
  }
  const trimmed = label ? String(label).trim() : '';
  if (trimmed && trimmed.toLowerCase() !== raw.toLowerCase()) {
    return translate ? translate(trimmed) : trimmed;
  }
  return raw;
}

function getIntlLanguageList(display, translate) {
  if (typeof Intl === 'undefined' || typeof Intl.supportedValuesOf !== 'function') {
    return [];
  }
  return Intl.supportedValuesOf('language').map((code) => ({
    code,
    label: formatLanguageLabel(code, null, display, translate),
  }));
}

function normalizeLanguageOption(item, display, translate) {
  if (!item) return null;
  if (typeof item === 'string') {
    const value = normalizeLanguageCode(item);
    if (!value) return null;
    return { value, label: formatLanguageLabel(value, null, display, translate) };
  }
  if (typeof item === 'object') {
    const rawValue = item.code ?? item.value ?? item.locale;
    const value = normalizeLanguageCode(rawValue);
    if (!value) return null;
    const label = formatLanguageLabel(value, item.label ?? item.name, display, translate);
    return { value, label };
  }
  return null;
}

function resolveOptionLabel(options, value) {
  if (!value) return '';
  const match = options.find((option) => option.value === value);
  return match ? match.label : value;
}

function getCurrentUserId() {
  let token = null;
  try {
    token = localStorage.getItem('token');
  } catch (err) {
    console.warn('Unable to access auth token', err);
    return null;
  }
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const body = JSON.parse(atob(payload));
    return body?.id ?? null;
  } catch {
    return null;
  }
}

function normalizeBoolean(value) {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GeneralTab({ forceRefreshKey, onDirtyChange }) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [supportedLanguages, setSupportedLanguages] = useState([]);
  const [appearanceEnabled, setAppearanceEnabled] = useState(false);
  const [mapEnabled, setMapEnabled] = useState(false);
  const [appearanceValues, setAppearanceValues] = useState({ theme: 'system', language: 'en' });
  const [mapValues, setMapValues] = useState({
    map_view: 'municipality',
    zoom: 12,
    marker_style: 'icons',
    show_registered_cities: true,
    show_recycling_centers: true,
    show_trucks_live: true,
  });
  const [savingPersonal, setSavingPersonal] = useState(false);
  const userId = useMemo(() => getCurrentUserId(), []);
  const languageDisplay = useMemo(() => getLanguageDisplay(i18n.language || 'en'), [i18n.language]);
  const themeLabelMap = useMemo(() => {
    return new Map(
      THEMES.map((theme) => [theme.value, t(resolveOptionLabel(THEMES, theme.value))])
    );
  }, [i18n.language, t]);
  const mapViewLabelMap = useMemo(() => {
    return new Map(
      MAP_VIEWS.map((view) => [view.value, t(resolveOptionLabel(MAP_VIEWS, view.value))])
    );
  }, [i18n.language, t]);
  const markerStyleLabelMap = useMemo(() => {
    return new Map(
      MARKER_STYLES.map((style) => [style.value, t(resolveOptionLabel(MARKER_STYLES, style.value))])
    );
  }, [i18n.language, t]);
  const { setThemePreference } = useTheme();
  const languageLabelMap = useMemo(() => {
    const map = new Map();
    supportedLanguages.forEach((item) => {
      const normalized = normalizeLanguageOption(item, languageDisplay, t);
      if (!normalized) return;
      map.set(normalized.value, normalized.label);
    });
    return map;
  }, [languageDisplay, supportedLanguages, t]);
  const languageOptions = useMemo(() => {
    const options = new Map(languageLabelMap);
    const addLanguage = (value) => {
      const code = normalizeLanguageCode(value);
      if (!code) return;
      if (!options.has(code)) {
        options.set(code, code);
      }
    };

    addLanguage(data?.effective?.language);
    addLanguage(data?.municipalitySettings?.default_language);
    addLanguage(data?.userSettings?.language);
    addLanguage(appearanceValues.language);

    return Array.from(options, ([value, label]) => ({
      value,
      label: formatLanguageLabel(value, label, languageDisplay, t),
    }));
  }, [appearanceValues.language, data, languageDisplay, languageLabelMap, t]);
  const effectiveLanguageLabel = useMemo(() => {
    const value = data?.effective?.language;
    const code = normalizeLanguageCode(value);
    if (!code) return '';
    return formatLanguageLabel(code, languageLabelMap.get(code), languageDisplay, t);
  }, [data?.effective?.language, languageDisplay, languageLabelMap, t]);
  const effectiveThemeLabel = useMemo(() => {
    const value = data?.effective?.theme;
    if (!value) return '';
    return themeLabelMap.get(value) || t(value);
  }, [data?.effective?.theme, i18n.language, t, themeLabelMap]);
  const effectiveMapViewLabel = useMemo(() => {
    const value = data?.effective?.map_view;
    if (!value) return '';
    return mapViewLabelMap.get(value) || t(value);
  }, [data?.effective?.map_view, i18n.language, mapViewLabelMap, t]);
  const effectiveMarkerStyleLabel = useMemo(() => {
    const value = data?.effective?.marker_style;
    if (!value) return '';
    return markerStyleLabelMap.get(value) || t(value);
  }, [data?.effective?.marker_style, i18n.language, markerStyleLabelMap, t]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: resp } = await fetchGeneral();
      setData(resp);
      const resolvedLanguage =
        normalizeLanguageCode(resp.userSettings.language ?? resp.effective.language) || 'en';
      setAppearanceValues({
        theme: resp.userSettings.theme ?? resp.effective.theme,
        language: resolvedLanguage,
      });
      setMapValues({
        map_view: resp.userSettings.map_view ?? resp.effective.map_view,
        zoom: resp.userSettings.zoom ?? resp.effective.zoom,
        marker_style: resp.userSettings.marker_style ?? resp.effective.marker_style,
        show_registered_cities:
          resp.userSettings.show_registered_cities ?? resp.effective.show_registered_cities,
        show_recycling_centers:
          resp.userSettings.show_recycling_centers ?? resp.effective.show_recycling_centers,
        show_trucks_live:
          resp.userSettings.show_trucks_live ?? resp.effective.show_trucks_live,
      });
      setAppearanceEnabled(
        resp.userSettings.theme != null || resp.userSettings.language != null
      );
      setMapEnabled(
        resp.userSettings.map_view != null ||
          resp.userSettings.zoom != null ||
          resp.userSettings.marker_style != null ||
          resp.userSettings.show_registered_cities != null ||
          resp.userSettings.show_recycling_centers != null ||
          resp.userSettings.show_trucks_live != null
      );
    } catch (err) {
      console.error('General settings load failed', err);
      setError(err.response?.data?.message || 'Could not load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [forceRefreshKey, loadSettings]);

  useEffect(() => {
    let isActive = true;
    const loadLanguages = async () => {
      try {
        const { data: resp } = await fetchLanguages();
        if (!isActive) return;
        const languages = Array.isArray(resp?.languages) ? resp.languages : [];
        setSupportedLanguages(
          languages.length ? languages : getIntlLanguageList(languageDisplay, t)
        );
      } catch (err) {
        console.error('Language list load failed', err);
        if (isActive) {
          setSupportedLanguages(getIntlLanguageList(languageDisplay, t));
        }
      }
    };

    loadLanguages();
    return () => {
      isActive = false;
    };
  }, [languageDisplay, t]);

  useEffect(() => {
    const unsubMunicipality = subscribeToSettings('municipalitySettingsUpdated', (payload) => {
      if (payload?.municipality_id && payload.municipality_id === data?.municipality_id) {
        loadSettings();
      }
    });
    const unsubUser = subscribeToSettings('userSettingsUpdated', (payload) => {
      if (payload?.user_id && payload.user_id === userId) {
        loadSettings();
      }
    });
    return () => {
      unsubMunicipality();
      unsubUser();
    };
  }, [data?.municipality_id, loadSettings, userId]);

  const savedPersonal = data?.userSettings ?? {};
  const normalizedSavedPersonal = {
    theme: savedPersonal.theme ?? null,
    language: normalizeLanguageCode(savedPersonal.language) || null,
    map_view: savedPersonal.map_view ?? null,
    zoom: normalizeNumber(savedPersonal.zoom),
    marker_style: savedPersonal.marker_style ?? null,
    show_registered_cities: normalizeBoolean(savedPersonal.show_registered_cities),
    show_recycling_centers: normalizeBoolean(savedPersonal.show_recycling_centers),
    show_trucks_live: normalizeBoolean(savedPersonal.show_trucks_live),
  };

  const normalizedCurrentPersonal = {
    theme: appearanceEnabled ? appearanceValues.theme : null,
    language: appearanceEnabled ? normalizeLanguageCode(appearanceValues.language) : null,
    map_view: mapEnabled ? mapValues.map_view : null,
    zoom: mapEnabled ? normalizeNumber(mapValues.zoom) : null,
    marker_style: mapEnabled ? mapValues.marker_style : null,
    show_registered_cities: mapEnabled ? mapValues.show_registered_cities : null,
    show_recycling_centers: mapEnabled ? mapValues.show_recycling_centers : null,
    show_trucks_live: mapEnabled ? mapValues.show_trucks_live : null,
  };

  const personalDirty = JSON.stringify(normalizedSavedPersonal) !== JSON.stringify(normalizedCurrentPersonal);

  const isDirty = personalDirty;

  useEffect(() => {
    if (!data) return;
    const effectiveTheme = data?.effective?.theme ?? 'system';
    const nextTheme = appearanceEnabled ? appearanceValues.theme : effectiveTheme;
    setThemePreference(nextTheme ?? 'system');
  }, [appearanceEnabled, appearanceValues.theme, data?.effective?.theme, setThemePreference]);

  // Apply language changes globally via i18next
  useEffect(() => {
    const effectiveLanguage = data?.effective?.language ?? 'en';
    const nextLanguage = appearanceEnabled ? appearanceValues.language : effectiveLanguage;
    const code = normalizeLanguageCode(nextLanguage) || 'en';
    if (i18next.language !== code) {
      i18next.changeLanguage(code);
    }
  }, [appearanceEnabled, appearanceValues.language, data?.effective?.language]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useDirtyGuard(isDirty);

  const handleSavePersonal = async () => {
    setSavingPersonal(true);
    try {
      await saveGeneralSettings(normalizedCurrentPersonal);
      toast.success(t('Preferences saved'));
      loadSettings();
    } catch (err) {
      console.error('Save general settings failed', err);
      toast.error(t(err.response?.data?.message || 'Could not save preferences'));
    } finally {
      setSavingPersonal(false);
    }
  };

  const handleResetPersonal = async () => {
    try {
      await resetGeneralSettings();
      toast.success(t('Preferences reset to defaults'));
      setAppearanceEnabled(false);
      setMapEnabled(false);
      loadSettings();
    } catch (err) {
      console.error('Reset general settings failed', err);
      toast.error(t(err.response?.data?.message || 'Could not reset preferences'));
    }
  };

  const handleResetMap = () => {
    if (!data) return;
    setMapEnabled(false);
    setMapValues({
      map_view: data.effective.map_view,
      zoom: data.effective.zoom,
      marker_style: data.effective.marker_style,
      show_registered_cities: data.effective.show_registered_cities,
      show_recycling_centers: data.effective.show_recycling_centers,
      show_trucks_live: data.effective.show_trucks_live,
    });
  };

  const handleResetAppearance = () => {
    if (!data) return;
    setAppearanceEnabled(false);
    setAppearanceValues({
      theme: data.effective.theme,
      language: normalizeLanguageCode(data.effective.language) || 'en',
    });
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 rounded-xl bg-slate-200 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-44 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-44 rounded-xl bg-slate-200 animate-pulse" />
        </div>
        <div className="h-64 rounded-xl bg-slate-200 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-600">{t(error)}</div>}

      <div className="panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Appearance')}</h3>
            <p className="text-sm text-slate-500">
              {t('Override the theme or language for your account.')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={appearanceEnabled}
              onChange={(event) => setAppearanceEnabled(event.target.checked)}
            />
            {t('Use my own setting')}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('Theme')}
            </p>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              disabled={!appearanceEnabled}
              value={appearanceValues.theme}
              onChange={(event) =>
                setAppearanceValues((prev) => ({ ...prev, theme: event.target.value }))
              }
            >
              {THEMES.map((theme) => (
                <option key={theme.value} value={theme.value}>
                  {t(theme.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('Language')}
            </p>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              value={appearanceValues.language}
              onChange={(event) =>
                setAppearanceValues((prev) => ({
                  ...prev,
                  language: normalizeLanguageCode(event.target.value) || prev.language,
                }))
              }
              disabled={!appearanceEnabled}
            >
              {languageOptions.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {t('Effective theme:')}{' '}
          <span className="font-semibold text-slate-700">{effectiveThemeLabel}</span>
          , {t('language:')}{' '}
          <span className="font-semibold text-slate-700">{effectiveLanguageLabel}</span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary px-4 py-2"
            onClick={handleResetAppearance}
            disabled={!appearanceEnabled}
          >
            {t('Reset to municipality defaults')}
          </button>
        </div>
      </div>

      <div className="panel space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-700">{t('Dashboard map view')}</h3>
            <p className="text-sm text-slate-500">
              {t('Customize the default map zoom, view, and layers.')}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input
              type="checkbox"
              checked={mapEnabled}
              onChange={(event) => setMapEnabled(event.target.checked)}
            />
            {t('Use my own setting')}
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('Map view')}
            </p>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              disabled={!mapEnabled}
              value={mapValues.map_view}
              onChange={(event) =>
                setMapValues((prev) => ({ ...prev, map_view: event.target.value }))
              }
            >
              {MAP_VIEWS.map((view) => (
                <option key={view.value} value={view.value}>
                  {t(view.label)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('Zoom')}
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="20"
                value={mapValues.zoom}
                disabled={!mapEnabled}
                onChange={(event) =>
                  setMapValues((prev) => ({ ...prev, zoom: Number(event.target.value) }))
                }
                className="w-full"
              />
              <span className="w-10 text-right text-sm font-semibold text-slate-700">
                {mapValues.zoom}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('Marker style')}
            </p>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
              disabled={!mapEnabled}
              value={mapValues.marker_style}
              onChange={(event) =>
                setMapValues((prev) => ({ ...prev, marker_style: event.target.value }))
              }
            >
              {MARKER_STYLES.map((style) => (
                <option key={style.value} value={style.value}>
                  {t(style.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            {['show_registered_cities', 'show_recycling_centers', 'show_trucks_live'].map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={mapValues[key]}
                  disabled={!mapEnabled}
                  onChange={(event) =>
                    setMapValues((prev) => ({ ...prev, [key]: event.target.checked }))
                  }
                />
                {key === 'show_registered_cities'
                  ? t('Show registered cities')
                  : key === 'show_recycling_centers'
                  ? t('Show recycling centers')
                  : t('Show trucks live location')}
              </label>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {t('Effective view:')}{' '}
          <span className="font-semibold text-slate-700">{effectiveMapViewLabel}</span>, {t('zoom')}{' '}
          <span className="font-semibold text-slate-700">{data?.effective?.zoom}</span>, {t('marker style')}{' '}
          <span className="font-semibold text-slate-700">{effectiveMarkerStyleLabel}</span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary px-4 py-2"
            onClick={handleResetMap}
            disabled={!mapEnabled}
          >
            {t('Reset to municipality defaults')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary px-5 py-2"
          onClick={handleSavePersonal}
          disabled={!personalDirty || savingPersonal}
        >
          {savingPersonal ? t('Saving...') : t('Save personal preferences')}
        </button>
        <button
          type="button"
          className="btn-secondary px-4 py-2"
          onClick={handleResetPersonal}
          disabled={savingPersonal}
        >
          {t('Reset my overrides')}
        </button>
      </div>

    </div>
  );
}
