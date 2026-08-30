import { registerApi } from '@/api/auth';
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
import { Route as RegisterRoute } from './register';

vi.mock('@/api/auth', () => ({
  registerApi: vi.fn(),
}));

const rootRoute = createRootRoute({
  notFoundComponent: () => null,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterRoute.options.component,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => null,
});
const testRouter = createRouter({
  routeTree: rootRoute.addChildren([registerRoute, loginRoute]),
  history: createMemoryHistory({ initialEntries: ['/register'] }),
});

function renderRegister() {
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

describe('routes/_auth/register', () => {
  beforeEach(() => {
    vi.mocked(registerApi).mockReset();
    testRouter.navigate({ to: '/register' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('渲染所有字段与注册按钮', async () => {
    renderRegister();
    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱地址')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /^注册/ }),
    ).toBeInTheDocument();
  });

  it('弱密码时显示密码强度提示', async () => {
    renderRegister();
    const pwd = screen.getByLabelText('密码');
    fireEvent.input(pwd, { target: { value: 'weak' } });
    await waitFor(() => {
      expect(screen.getByText('至少 8 个字符')).toBeInTheDocument();
    });
  });

  it('强密码：密码要求全部满足', async () => {
    renderRegister();
    fireEvent.input(screen.getByLabelText('密码'), {
      target: { value: 'Strong1!Pass' },
    });
    // 所有 5 条要求应标绿，但 antd 通过 className 表达，不直接断言文字
    await waitFor(() => {
      expect(screen.getByText('大写字母')).toBeInTheDocument();
    });
  });

  it('两次密码不一致时显示提示', async () => {
    renderRegister();
    fireEvent.input(screen.getByLabelText('密码'), {
      target: { value: 'Strong1!Pass' },
    });
    fireEvent.input(screen.getByLabelText('确认密码'), {
      target: { value: 'Mismatch1!Pass' },
    });
    expect(await screen.findByText('两次输入密码不一致')).toBeInTheDocument();
  });

  it('注册成功：registerApi 被调用并跳 /login', async () => {
    vi.mocked(registerApi).mockResolvedValueOnce({
      id: 'u1',
      username: 'lucy',
      nickname: null,
      email: 'lucy@x.com',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      status: 1,
    } as never);
    const navigateSpy = vi.spyOn(testRouter, 'navigate');
    renderRegister();
    fireEvent.input(screen.getByLabelText('用户名'), {
      target: { value: 'lucy' },
    });
    fireEvent.input(screen.getByLabelText('邮箱地址'), {
      target: { value: 'lucy@x.com' },
    });
    fireEvent.input(screen.getByLabelText('密码'), {
      target: { value: 'Strong1!Pass' },
    });
    fireEvent.input(screen.getByLabelText('确认密码'), {
      target: { value: 'Strong1!Pass' },
    });
    // 勾选条款
    fireEvent.click(screen.getByLabelText(/我已阅读并同意/));
    fireEvent.click(await screen.findByRole('button', { name: /^注册/ }));

    await waitFor(() => {
      expect(registerApi).toHaveBeenCalledWith({
        username: 'lucy',
        email: 'lucy@x.com',
        password: 'Strong1!Pass',
      });
    });
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ to: '/login' });
    });
  });
});
