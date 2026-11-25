import { ThemeSwitcher } from '@/theme/switch/theme-switcher';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// jsdom 未实现 ResizeObserver，而 antd Dropdown 挂载时经 rc-resize-observer 使用它，
// 这里按测试环境补齐桩（非产品逻辑改动），否则组件一挂载即抛 ReferenceError。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// vi.mock 工厂会提升到文件顶部，工厂内引用的变量必须用 vi.hoisted 定义
const { setModeMock, useThemeState } = vi.hoisted(() => ({
  setModeMock: vi.fn(),
  // 当前 useTheme 返回值；测试中可改写以模拟 dark/light 状态
  useThemeState: { mode: 'light', resolvedTheme: 'light' as 'light' | 'dark' },
}));

vi.mock('@/theme/ThemeProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/theme/ThemeProvider')>();
  return {
    ...actual,
    useTheme: () => ({
      mode: useThemeState.mode,
      setMode: setModeMock,
      resolvedTheme: useThemeState.resolvedTheme,
    }),
  };
});

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    setModeMock.mockReset();
  });

  it('点击菜单项切换为暗色', async () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));
    fireEvent.click(await screen.findByText('暗色'));
    expect(setModeMock).toHaveBeenCalledWith('dark');
  });

  it('点击菜单项切换为跟随系统', async () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));
    fireEvent.click(await screen.findByText('跟随系统'));
    expect(setModeMock).toHaveBeenCalledWith('system');
  });

  it('resolvedTheme 为 dark 时触发器显示月亮图标', async () => {
    // 图标只表达主题态：断言「亮/暗两态的触发器图标不同」，不绑 antd 的 anticon-* 类名
    const triggerIcon = () =>
      screen.getByRole('button', { name: '切换主题' }).querySelector('svg')
        ?.outerHTML ?? '';

    useThemeState.mode = 'light';
    useThemeState.resolvedTheme = 'light';
    const light = render(<ThemeSwitcher />);
    const lightIcon = triggerIcon();
    light.unmount();

    useThemeState.mode = 'dark';
    useThemeState.resolvedTheme = 'dark';
    render(<ThemeSwitcher />);
    const trigger = screen.getByRole('button', { name: '切换主题' });
    expect(trigger).toBeInTheDocument();
    expect(triggerIcon()).not.toBe('');
    expect(triggerIcon()).not.toBe(lightIcon);
    useThemeState.mode = 'light';
    useThemeState.resolvedTheme = 'light';
  });
});
