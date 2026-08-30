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
import { ThemeSwitcher } from './theme-switcher.tsx';

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

vi.mock('@/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/theme')>();
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
    // 覆盖共享状态：resolvedTheme='dark'，覆盖行 19 三元的另一分支
    useThemeState.mode = 'dark';
    useThemeState.resolvedTheme = 'dark';
    render(<ThemeSwitcher />);
    const trigger = screen.getByRole('button', { name: '切换主题' });
    expect(trigger).toBeInTheDocument();
    // dark 分支用 MoonOutlined（aria-hidden svg），light 用 SunOutlined。
    // 通过 svg 数量区分：light 也只有 1 个 svg，所以额外断言存在
    // antd icon-moon 字体类，证明确实进入了 dark 分支。
    const moonIcon = trigger.querySelector('.anticon-moon');
    expect(moonIcon).not.toBeNull();
    useThemeState.mode = 'light';
    useThemeState.resolvedTheme = 'light';
  });
});
