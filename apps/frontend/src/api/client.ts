import type { ApiResponse } from '@lucy/shared';
import ky from 'ky';
import { applyTokens, authStore, handleSessionExpired } from '../stores/auth';
import type { AuthTokens, RefreshRequest } from './types';

export class ApiError extends Error {
  code?: number;
  status?: number;

  constructor(message: string, code?: number, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// 解包 { code, message, data } 信封；非 0 / 非 2xx 抛出 ApiError
async function unwrapResponse(response: Response): Promise<Response> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as ApiResponse<unknown> | null;
  if (!response.ok || body?.code !== 0) {
    throw new ApiError(
      body?.message ?? `请求失败（${response.status}）`,
      body?.code,
      response.status,
    );
  }
  return new Response(JSON.stringify(body.data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setAuthHeader(request: Request): void {
  const accessToken = authStore.get().accessToken;
  if (accessToken) {
    request.headers.set('Authorization', `Bearer ${accessToken}`);
  } else {
    request.headers.delete('Authorization');
  }
}

// 公共实例：登录/注册/刷新，不附加认证头、不做 401 自动刷新
export const publicHttp = ky.create({
  prefix: '/',
  hooks: {
    afterResponse: [async ({ response }) => unwrapResponse(response)],
  },
});

// 认证实例：附加 Bearer，401 时自动刷新并带新 token 重试一次
export const http = ky.create({
  prefix: '/',
  retry: 1,
  hooks: {
    beforeRequest: [({ request }) => setAuthHeader(request)],
    afterResponse: [
      async ({ request, response, retryCount }) => {
        if (response.status === 401 && retryCount === 0) {
          await refreshTokens();
          setAuthHeader(request);
          return ky.retry({ request: new Request(request) });
        }
        return unwrapResponse(response);
      },
    ],
  },
});

let refreshPromise: Promise<AuthTokens> | null = null;

async function doRefresh(): Promise<AuthTokens> {
  const { refreshToken } = authStore.get();
  if (!refreshToken) {
    handleSessionExpired();
    throw new ApiError('登录已过期，请重新登录');
  }
  try {
    const body: RefreshRequest = { refreshToken };
    const tokens = await publicHttp
      .post('auth/refresh', { json: body })
      .json<AuthTokens>();
    applyTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  } catch {
    handleSessionExpired();
    throw new ApiError('登录已过期，请重新登录');
  }
}

/** 单飞：并发 401 只触发一次刷新，其余请求复用同一次刷新结果 */
export function refreshTokens(): Promise<AuthTokens> {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
