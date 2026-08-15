import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTokens,
  authStore,
  login,
  logout,
  registerSessionExpired,
} from '../stores/auth';
import { makeUser } from '../test/fixtures';
import { ApiError, http, refreshTokens } from './client';

const fetchMock = vi.fn();
const user = makeUser();

const okEnvelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
  });
const refreshEnvelope = (accessToken: string) => okEnvelope({ accessToken });

describe('api/client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    logout();
    registerSessionExpired(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('信封解包与错误归一化', () => {
    it('解包成功响应并返回 data', async () => {
      fetchMock.mockResolvedValueOnce(okEnvelope({ id: '1' }));
      const data = await http
        .post<{ id: string }>('auth/login', { account: 'a', password: 'b' })
        .json();
      expect(data).toEqual({ id: '1' });
    });

    it('业务错误码抛出 ApiError', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 40102, message: '密码错误', data: null }),
          { status: 200 },
        ),
      );
      await expect(http.post('auth/login', {}).json()).rejects.toMatchObject({
        name: 'ApiError',
        code: 40102,
        message: '密码错误',
      });
    });

    it('HTTP 错误状态抛出 ApiError 并携带 status', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 50000, message: '服务器错误', data: null }),
          { status: 500 },
        ),
      );
      await expect(http.post('auth/login', {}).json()).rejects.toMatchObject({
        name: 'ApiError',
        code: 50000,
        status: 500,
        message: '服务器错误',
      });
    });
  });

  describe('认证头', () => {
    it('有短效 token 时附加 Bearer 头', async () => {
      login(user);
      applyTokens('tok');
      fetchMock.mockResolvedValueOnce(okEnvelope({ ok: true }));
      await http.post<{ ok: boolean }>('auth/logout').json();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    });

    it('无短效 token 时不附加 Authorization 头，也不触发预刷新', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(okEnvelope({ ok: true }));
      await http.post('auth/logout').json();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('401 自动刷新', () => {
    it('401 时刷新并携带新令牌重试一次', async () => {
      login(user);
      applyTokens('expired');
      fetchMock
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(refreshEnvelope('new-token'))
        .mockResolvedValueOnce(okEnvelope({ ok: true }));

      const result = await http.post<{ ok: boolean }>('auth/logout').json();
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(authStore.get().accessToken).toBe('new-token');
      const retried = fetchMock.mock.calls[2][1] as RequestInit;
      expect(new Headers(retried.headers).get('Authorization')).toBe(
        'Bearer new-token',
      );
    });

    it('401 且刷新失败时请求被拒绝', async () => {
      login(user);
      applyTokens('expired');
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockRejectedValueOnce(new TypeError('network'));

      await expect(http.post('auth/logout').json()).rejects.toThrow(
        '登录已过期，请重新登录',
      );
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('刷新后重放仍 401 判定会话过期', async () => {
      login(user);
      applyTokens('expired');
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(refreshEnvelope('new'))
        .mockResolvedValueOnce(new Response('', { status: 401 }));

      await expect(http.post('auth/logout').json()).rejects.toThrow(
        '登录已过期，请重新登录',
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('skipAuthRefresh 的请求不触发 401 刷新', async () => {
      login(user);
      applyTokens('expired');
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 40101, message: '密码错误', data: null }),
          { status: 401 },
        ),
      );
      await expect(
        http
          .post('auth/login', {}, { extra: { skipAuthRefresh: true } })
          .json(),
      ).rejects.toMatchObject({ name: 'ApiError', code: 40101, status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshTokens', () => {
    it('单飞：并发刷新只发一次请求', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      const [a, b] = await Promise.all([refreshTokens(), refreshTokens()]);
      expect(a).toEqual({ accessToken: 'at2' });
      expect(b).toBe(a);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('刷新成功后写入短效 token 并保留用户', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      await refreshTokens();
      expect(authStore.get().accessToken).toBe('at2');
      expect(authStore.get().user).toBe(user);
    });

    it('刷新请求不携带业务 body（只发空 JSON）', async () => {
      login(user);
      fetchMock.mockResolvedValueOnce(refreshEnvelope('at2'));
      await refreshTokens();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      // hook-fetch 对 JSON POST 总是序列化 body；data 为 undefined 时产出一个空对象。
      // 校验其不含长效 token（旧实现 body 携带 { refreshToken }）。
      expect(String(init.body)).not.toContain('refreshToken');
    });

    it('刷新失败时过期并拒绝', async () => {
      login(user);
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock.mockRejectedValueOnce(new TypeError('network'));
      await expect(refreshTokens()).rejects.toThrow('登录已过期，请重新登录');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('刷新返回 401（无 cookie）时过期并拒绝', async () => {
      login(user);
      const handler = vi.fn();
      registerSessionExpired(handler);
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      await expect(refreshTokens()).rejects.toThrow('登录已过期，请重新登录');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('ApiError', () => {
    it('构造时可携带 code 与 status', () => {
      const err = new ApiError('boom', 42, 500);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ApiError');
      expect(err.code).toBe(42);
      expect(err.status).toBe(500);
    });
  });
});
