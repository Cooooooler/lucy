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
const { setModeMock } = vi.hoisted(() => ({ setModeMock: vi.fn() }));

vi.mock('@/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/theme')>();
  return {
    ...actual,
    useTheme: () => ({
      mode: 'light',
      setMode: setModeMock,
      resolvedTheme: 'light',
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
});
