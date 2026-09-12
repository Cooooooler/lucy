import { authStore } from '@/stores/auth';
import { makeUser } from '@/test/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { ReactNode } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { Route as UsersRoute } from './users';

vi.mock('@ant-design/pro-components', () => ({
  ProTable: () => <div data-testid="protable" />,
}));

vi.mock('@/hooks/use-users', () => ({
  useUserList: () => ({ data: undefined, isLoading: false }),
  useUpdateUserStatus: () => ({ mutateAsync: vi.fn() }),
  useUpdateUserRole: () => ({ mutateAsync: vi.fn() }),
  useDeleteUser: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    redirect: vi.fn((opts) => {
      throw new Error(`redirect:${opts.to}`);
    }),
  };
});

function getBeforeLoad() {
  return (
    UsersRoute as unknown as {
      options: {
        beforeLoad: (args: {
          context: { auth: { ready: Promise<void>; isAuthenticated: boolean } };
        }) => Promise<void>;
      };
    }
  ).options.beforeLoad;
}

function authedContext() {
  return {
    context: { auth: { ready: Promise.resolve(), isAuthenticated: true } },
  };
}

describe('routes/_layout/users', () => {
  it('导出 Route 带 beforeLoad 守卫', () => {
    expect(typeof getBeforeLoad()).toBe('function');
  });

  it('未登录时跳 /login', async () => {
    await expect(
      getBeforeLoad()({
        context: { auth: { ready: Promise.resolve(), isAuthenticated: false } },
      }),
    ).rejects.toThrow('redirect:/login');
    expect(redirect as unknown as Mock).toHaveBeenCalledWith({ to: '/login' });
  });

  it('普通用户访问时跳回首页', async () => {
    authStore.setState(() => ({
      user: makeUser({ role: 'user' }),
      accessToken: null,
    }));
    await expect(getBeforeLoad()(authedContext())).rejects.toThrow(
      'redirect:/',
    );
    expect(redirect as unknown as Mock).toHaveBeenCalledWith({ to: '/' });
    authStore.setState(() => ({ user: null, accessToken: null }));
  });

  it('admin 可进入页面', async () => {
    authStore.setState(() => ({
      user: makeUser({ role: 'admin' }),
      accessToken: null,
    }));
    await expect(getBeforeLoad()(authedContext())).resolves.toBeUndefined();
    authStore.setState(() => ({ user: null, accessToken: null }));
  });

  it('渲染用户管理表格', async () => {
    const Component = (
      UsersRoute as unknown as { options: { component: () => ReactNode } }
    ).options.component;
    render(
      <AntdApp>
        <QueryClientProvider client={new QueryClient()}>
          <Component />
        </QueryClientProvider>
      </AntdApp>,
    );
    expect(await screen.findByTestId('protable')).toBeInTheDocument();
    authStore.setState(() => ({ user: null, accessToken: null }));
  });
});
