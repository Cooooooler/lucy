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

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function resolveTheme(
  safeMode: ThemeMode,
  systemDark: boolean,
): 'light' | 'dark' {
  if (safeMode === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return safeMode;
}

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

// 非 system 模式不订阅 matchMedia，避免系统主题变化触发多余重渲染
function subscribeNothing(): () => void {
  return () => {};
}

function getNoSystemDark(): boolean {
  return false;
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [mode, setModeState] = useLocalStorageState<ThemeMode>(THEME_KEY, {
    defaultValue: 'system',
  });

  // localStorage 值可能被篡改/损坏，运行时校验非法值回退 system（并写回自愈）
  const safeMode: ThemeMode = isThemeMode(mode) ? mode : 'system';

  useEffect(() => {
    if (mode !== safeMode) {
      setModeState(safeMode);
    }
  }, [mode, safeMode, setModeState]);

  const systemDark = useSyncExternalStore(
    safeMode === 'system' ? subscribeSystemDark : subscribeNothing,
    safeMode === 'system' ? getSystemDark : getNoSystemDark,
  );

  // 仅 system 依赖动态的 systemDark，其余直接取模式；避免每次渲染重建临时对象
  const resolvedTheme: 'light' | 'dark' = resolveTheme(safeMode, systemDark);

  const setMode = useCallback(
    (next: ThemeMode) => setModeState(next),
    [setModeState],
  );

  const contextValue = useMemo(
    () => ({ mode: safeMode, setMode, resolvedTheme }),
    [safeMode, setMode, resolvedTheme],
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
