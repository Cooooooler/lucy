import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUser } from '../test/fixtures.js';
import {
  deleteUserApi,
  getUserApi,
  listUsersApi,
  updateUserRoleApi,
  updateUserStatusApi,
} from './users.js';

// 保留真实 http（走真实 fetch 与完整插件链），仅覆盖 authStore 以便注入 Bearer
vi.mock('../stores/auth', () => ({
  authStore: { get: () => ({ accessToken: 'test-token' }) },
  applyTokens: vi.fn(),
  handleSessionExpired: vi.fn(),
}));

const fetchMock = vi.fn();

const okEnvelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
  });

describe('api/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listUsersApi 调用 GET /users 并透传查询参数', async () => {
    fetchMock.mockResolvedValueOnce(
      okEnvelope({ list: [makeUser()], total: 1, page: 1, pageSize: 20 }),
    );
    const result = await listUsersApi({
      page: 1,
      pageSize: 20,
      status: 1,
      keyword: 'ali',
    });
    expect(result.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users?page=1&pageSize=20&status=1&keyword=ali',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getUserApi 调用 GET /users/:id', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(makeUser()));
    const result = await getUserApi('u1');
    expect(result.id).toBe('1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users/u1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('updateUserStatusApi 调用 PATCH /users/:id/status', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(makeUser({ status: 0 })));
    const result = await updateUserStatusApi({
      id: 'u1',
      input: { status: 0 },
    });
    expect(result.status).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users/u1/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 0 }),
      }),
    );
  });

  it('updateUserRoleApi 调用 PATCH /users/:id/role', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(makeUser({ role: 'admin' })));
    const result = await updateUserRoleApi({
      id: 'u1',
      input: { role: 'admin' },
    });
    expect(result.role).toBe('admin');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users/u1/role',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      }),
    );
  });

  it('deleteUserApi 调用 DELETE /users/:id', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(null));
    await deleteUserApi('u1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users/u1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
