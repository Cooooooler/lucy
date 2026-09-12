import type { User } from '@/api/types';
import { makeUser } from '@/test/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDeleteUser,
  useUpdateUserRole,
  useUpdateUserStatus,
  useUserDetail,
  useUserList,
  userKeys,
} from './use-users.js';

const api = vi.hoisted(() => ({
  listUsersApi: vi.fn(),
  getUserApi: vi.fn(),
  updateUserStatusApi: vi.fn(),
  updateUserRoleApi: vi.fn(),
  deleteUserApi: vi.fn(),
}));

vi.mock('@/api/users', () => api);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function createWrapperWithClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('use-users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useUserList 拉取分页用户', async () => {
    api.listUsersApi.mockResolvedValueOnce({
      list: [makeUser()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const { result } = renderHook(() => useUserList({ page: 1 }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(1);
    expect(api.listUsersApi).toHaveBeenCalledWith({ page: 1 });
  });

  it('useUserDetail 在 id 为空时不请求', () => {
    const { result } = renderHook(() => useUserDetail(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.getUserApi).not.toHaveBeenCalled();
  });

  it('useUpdateUserStatus 成功后失效列表缓存', async () => {
    const client = createTestQueryClient();
    client.setQueryData(userKeys.list({ page: 1 }), {
      list: [makeUser()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    api.updateUserStatusApi.mockResolvedValueOnce(makeUser({ status: 0 }));
    const { result } = renderHook(() => useUpdateUserStatus(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'u1', input: { status: 0 } });
    });
    expect(api.updateUserStatusApi).toHaveBeenCalledWith({
      id: 'u1',
      input: { status: 0 },
    });
    expect(
      client.getQueryState(userKeys.list({ page: 1 }))?.isInvalidated,
    ).toBe(true);
  });

  it('useUpdateUserRole 成功后失效列表缓存', async () => {
    const client = createTestQueryClient();
    client.setQueryData(userKeys.list({}), {
      list: [makeUser()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    api.updateUserRoleApi.mockResolvedValueOnce(makeUser({ role: 'admin' }));
    const { result } = renderHook(() => useUpdateUserRole(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'u1', input: { role: 'admin' } });
    });
    expect(api.updateUserRoleApi).toHaveBeenCalledWith({
      id: 'u1',
      input: { role: 'admin' },
    });
    expect(client.getQueryState(userKeys.list({}))?.isInvalidated).toBe(true);
  });

  it('useDeleteUser 成功后移除详情缓存并失效列表', async () => {
    const client = createTestQueryClient();
    const user: User = makeUser();
    client.setQueryData(userKeys.detail('u1'), user);
    api.deleteUserApi.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useDeleteUser(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync('u1');
    });
    expect(api.deleteUserApi).toHaveBeenCalledWith('u1');
    expect(client.getQueryData(userKeys.detail('u1'))).toBeUndefined();
  });
});
