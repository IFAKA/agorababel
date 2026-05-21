import { useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const themeModeStorageKey = 'agorababel:themeMode';

const systemDarkQuery = '(prefers-color-scheme: dark)';

function getStoredThemeMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(themeModeStorageKey);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function getSystemTheme(): Exclude<ThemeMode, 'system'> {
  return window.matchMedia(systemDarkQuery).matches ? 'dark' : 'light';
}

function applyThemeMode(mode: ThemeMode) {
  const resolvedMode = mode === 'system' ? getSystemTheme() : mode;
  document.documentElement.classList.toggle('dark', resolvedMode === 'dark');
  document.documentElement.style.colorScheme = resolvedMode;
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [systemMode, setSystemMode] = useState<Exclude<ThemeMode, 'system'>>(() => getSystemTheme());

  useEffect(() => {
    applyThemeMode(mode);
  }, [mode, systemMode]);

  useEffect(() => {
    const media = window.matchMedia(systemDarkQuery);
    const handleChange = () => {
      setSystemMode(getSystemTheme());
      applyThemeMode(getStoredThemeMode());
    };

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const setMode = useMemo(
    () => (nextMode: ThemeMode) => {
      setModeState(nextMode);
      try {
        window.localStorage.setItem(themeModeStorageKey, nextMode);
      } catch {
        // Local storage can be unavailable in hardened browser contexts.
      }
      applyThemeMode(nextMode);
    },
    [],
  );

  return {
    mode,
    resolvedMode: mode === 'system' ? systemMode : mode,
    setMode,
  };
}
