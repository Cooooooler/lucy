import { loginApi } from '@/api/auth';
import { logout } from '@/stores/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as LoginRoute } from './login';

vi.mock('@/api/auth', () => ({
  loginApi: vi.fn(),
}));

const rootRoute = createRootRoute({});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute.options.component,
});
const testRouter = createRouter({
  routeTree: rootRoute.addChildren([loginRoute]),
  history: createMemoryHistory({ initialEntries: ['/login'] }),
});

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AntdApp>
        <RouterProvider router={testRouter} />
      </AntdApp>
    </QueryClientProvider>,
  );
}

describe('routes/_auth/login', () => {
  beforeEach(() => {
    logout();
    vi.mocked(loginApi).mockReset();
    // 强制把 router 跳回 /login，避免上一个测试 navigate 后状态残留
    testRouter.navigate({ to: '/login' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('渲染表单字段与提交按钮', async () => {
    renderLogin();
    expect(screen.getByLabelText('用户名或邮箱')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /^登录/ }),
    ).toBeInTheDocument();
  });

  it('空表单提交时显示校验错误', async () => {
    renderLogin();
    const submit = await screen.findByRole('button', { name: /^登录/ });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText('请输入用户名或邮箱')).toBeInTheDocument();
      expect(screen.getByText('请输入密码')).toBeInTheDocument();
    });
    expect(loginApi).not.toHaveBeenCalled();
  });

  it('提交成功：loginApi 被调用并尝试跳转 /', async () => {
    const user = {
      id: 'u1',
      username: 'alice',
      nickname: null,
      email: 'a@x.com',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 1,
    } as never;
    vi.mocked(loginApi).mockResolvedValueOnce({
      user,
      accessToken: 'at',
      // 长效 token 在 HttpOnly cookie 里；测试mock带上以兼容旧签名
      refreshToken: 'rt',
    } as never);
    const navigateSpy = vi.spyOn(testRouter, 'navigate');
    renderLogin();

    fireEvent.input(screen.getByLabelText('用户名或邮箱'), {
      target: { value: 'alice' },
    });
    fireEvent.input(screen.getByLabelText('密码'), {
      target: { value: 'secret' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^登录/ }));

    await waitFor(() => {
      expect(loginApi).toHaveBeenCalledWith({
        account: 'alice',
        password: 'secret',
      });
    });
    // 跳 / 尝试被发起（由于 / 未注册，仅 verify 调用而不强求命中）
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ to: '/' });
    });
  });

  it('登录失败时显示 message 错误', async () => {
    vi.mocked(loginApi).mockRejectedValueOnce(new Error('账号或密码错误'));
    renderLogin();
    fireEvent.input(screen.getByLabelText('用户名或邮箱'), {
      target: { value: 'alice' },
    });
    fireEvent.input(screen.getByLabelText('密码'), {
      target: { value: 'bad' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^登录/ }));
    await waitFor(() => {
      expect(loginApi).toHaveBeenCalled();
    });
    const err = await screen.findByText('账号或密码错误');
    expect(err).toBeInTheDocument();
  });
});
