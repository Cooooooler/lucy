import type { User } from '@/api/types';
import {
  useDeleteUser,
  useUpdateUserRole,
  useUpdateUserStatus,
  useUserList,
} from '@/hooks/use-users';
import { authStore } from '@/stores/auth';
import { makeUser } from '@/test/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Route as UsersRoute } from './users';

vi.mock('@/hooks/use-users', () => ({
  useUserList: vi.fn(),
  useUpdateUserStatus: vi.fn(),
  useUpdateUserRole: vi.fn(),
  useDeleteUser: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  return {
    ...(await importOriginal()),
    redirect: vi.fn((opts) => {
      throw new Error(`redirect:${opts.to}`);
    }),
  };
});

const mockedList = vi.mocked(useUserList);
const refetch = vi.fn();

/** 用户列表查询桩：返回桩对象本身，便于用例在其上叠加状态 */
function mockList(list: User[], total: number) {
  const stub = {
    data: { list, total, page: 1, pageSize: 20 },
    isLoading: false,
    refetch,
  };
  mockedList.mockReturnValue(stub as never);
  return stub;
}

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

function renderPage() {
  const Component = (
    UsersRoute as unknown as { options: { component: () => ReactNode } }
  ).options.component;
  return render(
    <AntdApp>
      <QueryClientProvider client={new QueryClient()}>
        <Component />
      </QueryClientProvider>
    </AntdApp>,
  );
}

/** 在 ProTable 内置查询表单里输入并提交（jsdom 下 Enter 不等于表单提交，直接触发 submit） */
function submitSearch(value: string) {
  const input = screen.getByPlaceholderText('按用户名 / 邮箱 / 昵称搜索');
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}

// 打开 Modal 的用例在 v8 覆盖率插桩下约 5s（jsdom 的样式计算被放大），
// 默认 5s 会卡在边界上；这里给整份用例放宽到 15s，普通交互仍在 1s 内。
describe('routes/_layout/users', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStore.setState(() => ({
      user: makeUser({ id: 'me', role: 'admin' }),
      accessToken: null,
    }));
    mockList([makeUser()], 1);
    vi.mocked(useUpdateUserStatus).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
    vi.mocked(useUpdateUserRole).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
    vi.mocked(useDeleteUser).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never);
  });

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
  });

  it('admin 可进入页面', async () => {
    await expect(getBeforeLoad()(authedContext())).resolves.toBeUndefined();
  });

  it('用默认分页与空筛选查询，渲染表格与内置查询表单', () => {
    renderPage();

    expect(mockedList).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: undefined,
      status: undefined,
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('按用户名 / 邮箱 / 昵称搜索'),
    ).toBeInTheDocument();
    expect(screen.getByText('全部状态')).toBeInTheDocument();
  });

  it('搜索：回到第 1 页并把 trim 后的关键字交给查询', async () => {
    renderPage();

    submitSearch('  alice  ');

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        keyword: 'alice',
        status: undefined,
      }),
    );
  });

  it('重置：清空关键字与状态并回到第 1 页', async () => {
    renderPage();

    submitSearch('alice');
    fireEvent.click(screen.getByRole('button', { name: /重\s*置/ }));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({
        page: 1,
        pageSize: 20,
        keyword: undefined,
        status: undefined,
      }),
    );
  });

  it('翻页：把 page 交给查询', async () => {
    mockList(
      Array.from({ length: 20 }, (_, i) => makeUser({ id: `row-${i}` })),
      40,
    );
    renderPage();

    fireEvent.click(screen.getByTitle('2'));

    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith({
        page: 2,
        pageSize: 20,
        keyword: undefined,
        status: undefined,
      }),
    );
  });
});
