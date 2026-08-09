import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './index';

const THEME_KEY = 'lucy.theme';

function stubMatchMedia(matches: boolean) {
  const changeListeners = new Set<() => void>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: () => void) =>
      changeListeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) =>
      changeListeners.delete(cb),
    dispatchEvent: () => true,
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    setMatches(next: boolean) {
      mql.matches = next;
      changeListeners.forEach((cb) => cb());
    },
  };
}

function Probe() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setMode('dark')}>to-dark</button>
      <button onClick={() => setMode('light')}>to-light</button>
      <button onClick={() => setMode('system')}>to-system</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
  });

  it('默认 mode 为 system，resolved 跟随系统暗色并加 .dark', () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('切换到暗色/亮色时持久化、resolved 更新、.dark 应用与移除', async () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('to-dark'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    await waitFor(() => {
      expect(localStorage.getItem(THEME_KEY)).toBe('"dark"');
    });

    fireEvent.click(screen.getByText('to-light'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
    await waitFor(() => {
      expect(localStorage.getItem(THEME_KEY)).toBe('"light"');
    });
  });

  it('system 模式下系统偏好变化实时响应', () => {
    const sys = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => sys.setMatches(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('非 system 模式不响应系统偏好变化', () => {
    const sys = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('to-dark'));
    act(() => sys.setMatches(false));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('重新挂载时读回已存偏好', () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_KEY, '"light"');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('matchMedia 缺失时回退 light 且不抛错', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
