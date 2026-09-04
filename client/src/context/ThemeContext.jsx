import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchGeneral } from '../api/settingsApi.js';
import { AuthContext } from './AuthContext.jsx';
import { subscribeToSettings } from '../socket/settingsSocket.js';

const STORAGE_KEY = 'smart-waste-theme-preference';

function getSystemPreference() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const ThemeContext = createContext({
  preference: 'system',
  resolvedTheme: 'light',
  setThemePreference: () => {},
});

export function ThemeProvider({ children }) {
  const { user } = useContext(AuthContext);
  const [preference, setPreference] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? 'system';
    } catch (err) {
      console.warn('Unable to read theme preference', err);
      return 'system';
    }
  });
  const [systemPreference, setSystemPreference] = useState(getSystemPreference);
  const setThemePreference = useCallback((value) => {
    setPreference((prev) => (prev === value ? prev : value));
  }, []);

  const resolvedTheme = useMemo(
    () => (preference === 'system' ? systemPreference : preference),
    [preference, systemPreference]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, preference);
      }
    } catch (err) {
      console.error('Unable to persist theme preference', err);
    }
  }, [preference]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => setSystemPreference(event.matches ? 'dark' : 'light');
    media.addEventListener('change', handler);
    return () => {
      media.removeEventListener('change', handler);
    };
  }, []);

  const refreshPreference = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await fetchGeneral();
      setThemePreference(data?.effective?.theme ?? 'system');
    } catch (err) {
      console.error('Failed to load theme preference', err);
    }
  }, [user, setThemePreference]);

  useEffect(() => {
    refreshPreference();
  }, [refreshPreference]);

  useEffect(() => {
    if (!user) return undefined;
    const refetch = () => {
      refreshPreference();
    };
    const unsubUser = subscribeToSettings('userSettingsUpdated', refetch);
    const unsubMunicipality = subscribeToSettings('municipalitySettingsUpdated', refetch);
    return () => {
      unsubUser();
      unsubMunicipality();
    };
  }, [user, refreshPreference]);

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
