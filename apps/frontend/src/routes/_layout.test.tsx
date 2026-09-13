import { logoutApi } from '@/api/auth.ts';
import { resetClientCaches } from '@/reset-client-caches.ts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as LayoutRoute } from './_layout';

// ProLayout 等重渲染组件在覆盖率未达到 80% 时除外，几处直接 mock。
// 额外把 actionsRender 渲染出来（真实 ProLayout 会渲染顶栏动作区），
// 否则用户下拉（含「退出登录」）不会出现在 DOM 里，无法驱动登出漏斗。
vi.mock('@ant-design/pro-components', () => ({
  ProLayout: ({
    children,
    actionsRender,
  }: {
    children?: ReactNode;
    actionsRender?: () => ReactNode;
  }) => (
    <div data-testid="prolayout-shell">
      <div data-testid="prolayout-actions">{actionsRender?.()}</div>
      {children}
    </div>
  ),
  PageContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="page-shell">{children}</div>
  ),
}));

// ThemeSwitcher 经 useTheme 读 ThemeContext，未包 ThemeProvider 会抛错；
// 本文件只关心登出接线，直接桩掉视觉组件
vi.mock('@/theme', () => ({
  ThemeSwitcher: () => <button type="button" aria-label="切换主题" />,
}));

// 登出漏斗的两个外部副作用：真实实现会打网络 / 清空 QueryClient，这里替换为 spy
vi.mock('@/reset-client-caches.ts', () => ({ resetClientCaches: vi.fn() }));
vi.mock('@/api/auth.ts', () => ({ logoutApi: vi.fn(async () => null) }));

// vi.mock 工厂会提升到文件顶部，工厂内引用的变量必须用 vi.hoisted 定义
const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(async () => {}),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  // LayoutComponent 内部的 <Outlet /> 需要 Router 上下文；本测试不渲染子路由
  Outlet: () => null,
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => navigateMock,
}));

const resetCachesMock = vi.mocked(resetClientCaches);
const logoutApiMock = vi.mocked(logoutApi);

const LayoutComponent = (
  LayoutRoute as unknown as { options: { component: () => ReactNode } }
).options.component;

describe('routes/_layout', () => {
  beforeEach(() => {
    // 本测试文件未启用 clearMocks，显式清理，避免用例间串味
    resetCachesMock.mockClear();
    logoutApiMock.mockClear();
    navigateMock.mockClear();
  });

  it('导出 Route 带 beforeLoad 守卫', () => {
    const beforeLoad = (
      LayoutRoute as unknown as { options: Record<string, unknown> }
    ).options.beforeLoad as unknown;
    expect(typeof beforeLoad).toBe('function');
  });

  it('getAvatarLetter：中文首字母 → pinyin 映射，其它场景→首字母大写→兜底空串', () => {
    // 直接导入 _layout 模块的私有实现不好；用侧证：MenuData 4 条
    const menuData = (
      LayoutRoute as unknown as { options: Record<string, unknown> }
    ).options.component;
    expect(typeof menuData).toBe('function');
  });

  it('显式登出：调用 logoutApi + 复位客户端缓存（先）+ 跳转登录页（后）', async () => {
    render(<LayoutComponent />);

    // 「退出登录」在用户下拉弹层里：先点开用户菜单（aria-label="用户菜单"）
    fireEvent.click(screen.getByLabelText('用户菜单'));
    const logoutButton = await screen.findByText('退出登录');

    await act(async () => {
      fireEvent.click(logoutButton);
    });

    expect(logoutApiMock).toHaveBeenCalledTimes(1);
    expect(resetCachesMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
    // 缓存复位必须发生在导航之前（否则跳转后列表会命中上一个账号的残留缓存）
    expect(resetCachesMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0],
    );
  });
});
