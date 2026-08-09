import { useLocalStorageState } from 'ahooks';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (_mode: ThemeMode) => void;
  resolvedTheme: 'light' | 'dark';
}

const THEME_KEY = 'lucy.theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeSystemDark(callback: () => void): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {};
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [mode, setModeState] = useLocalStorageState<ThemeMode>(THEME_KEY, {
    defaultValue: 'system',
  });

  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark);

  const themeMap = {
    light: 'light',
    dark: 'dark',
    system: systemDark ? 'dark' : 'light',
  } as const;

  const resolvedTheme = themeMap[mode];

  const setMode = useCallback(
    (next: ThemeMode) => setModeState(next),
    [setModeState],
  );

  const contextValue = useMemo(
    () => ({ mode, setMode, resolvedTheme }),
    [mode, setMode, resolvedTheme],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  return (
    <ThemeContext value={contextValue}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm:
            resolvedTheme === 'dark'
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = use(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  }
  return ctx;
}
