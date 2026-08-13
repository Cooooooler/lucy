import type { ApiResponse } from '@lucy/shared';
import type { BodyType, HookFetchPlugin, RequestConfig } from 'hook-fetch';
import hookFetch, { ResponseError } from 'hook-fetch';
import { applyTokens, authStore, handleSessionExpired } from '../stores/auth';
import type { AuthTokens, RefreshRequest } from './types';

export class ApiError extends ResponseError {
  code?: number;

  constructor(
    message: string,
    code?: number,
    status?: number,
    response?: Response,
    config?: RequestConfig<unknown, BodyType, unknown>,
  ) {
    super({ message, status, response, config, name: 'ApiError' });
    this.code = code;
  }
}

// 请求级扩展字段：skipAuthRefresh 跳过 401 自动刷新，__authRetry 记录重放次数
type RequestExtra = { skipAuthRefresh?: boolean; __authRetry?: number };

// 基础配置：baseURL、Content-Type
const baseOptions = {
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
};

const authHeader: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'auth-header',
  beforeRequest(ctx) {
    // Headers 可能是 Headers、Record<string, string> 或 [string, string][]，统一转换为 Headers
    ctx.config.headers = new Headers(ctx.config.headers);
    // 获取 短效 token 并附加到请求头中；若没有 token，则删除 Authorization 头
    const accessToken = authStore.get().accessToken;
    if (accessToken) {
      ctx.config.headers.set('Authorization', `Bearer ${accessToken}`);
    } else {
      ctx.config.headers.delete('Authorization');
    }
    return ctx.config;
  },
};

// 统一错误归一化：非 2xx 响应从响应体还原业务码，包装成 ApiError
const normalizeError: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'normalize-error',
  async onError(ctx) {
    // ctx.error 可能是 ResponseError 或 ApiError，ApiError 已经归一化过了
    if (ctx.error instanceof ApiError) return;
    const { response, status } = ctx.error;
    // ResponseError 可能没有 response（如网络错误），此时无法从响应体还原业务码
    if (!response) return;
    const body: ApiResponse<unknown> = await response
      .clone()
      .json()
      .catch(() => null);
    if (body && body.code !== 0) {
      return ctx.reject(
        new ApiError(
          body.message ?? `请求失败（${status}）`,
          body.code,
          status,
          response,
          ctx.config,
        ),
      );
    }
    if (!response.ok) {
      return ctx.reject(
        new ApiError(
          `请求失败（${status}）`,
          undefined,
          status,
          response,
          ctx.config,
        ),
      );
    }
  },
};

// 解包 { code, message, data } 信封；非 0 / 非 2xx 抛出 ApiError
const unwrapEnvelope: HookFetchPlugin<ApiResponse<unknown>> = {
  name: 'unwrap-envelope',
  afterResponse(ctx) {
    if (ctx.responseType !== 'json') return ctx;
    const body = ctx.result;
    // 2xx 但业务码非 0（防御性处理）：仍按错误处理，还原业务码与 message
    if (body.code !== 0) {
      return ctx.reject(
        new ApiError(
          body.message ?? `请求失败（${ctx.response.status}）`,
          body.code,
          ctx.response.status,
          ctx.response,
          ctx.config,
        ),
      );
    }
    ctx.result = body.data as never;
    return ctx;
  },
};

// 401 → 单飞刷新 → 经实例重放一次（重放走完整插件链：authHeader 注入新 token、normalizeError错误处理、unwrapEnvelope 解包）。
// 重放后仍 401 视为会话过期；刷新失败原样抛会话过期错误
const refreshOn401: HookFetchPlugin<unknown, RequestExtra> = {
  name: 'refresh-on-401',
  // 自定义优先级：最低等级
  priority: -10,
  async onError(ctx) {
    // 如果不是401，就不处理了，这里是专门处理401错误的
    if (ctx.error.status !== 401) return;
    const extra = ctx.config.extra ?? {};
    // 如果请求配置里设置了 skipAuthRefresh，则认定为不需要刷新，直接返回
    if (extra.skipAuthRefresh) return;
    // 获取记录的重放次数
    const attempt = (extra.__authRetry ?? 0) + 1;
    // 大于1说明已经重放过一次了，说明刷新后仍然401，认定为会话过期
    if (attempt > 1) {
      // 执行刷新失败后的会话过期处理：清空本地会话并通知跳转登录页
      handleSessionExpired();
      return ctx.reject(new ApiError('登录已过期，请重新登录'));
    }
    try {
      // 调用刷新函数获取新的长短效 token，并更新本地存储
      await refreshTokens();
    } catch {
      return ctx.reject(new ApiError('登录已过期，请重新登录'));
    }
    try {
      // 重放一次401请求，附加新的 token，重放次数 +1
      const replay = await http
        .request(ctx.config.url, {
          method: ctx.config.method,
          headers: ctx.config.headers,
          params: ctx.config.params as Record<string, unknown> | undefined,
          data: ctx.config.data,
          qsConfig: ctx.config.qsConfig,
          extra: { ...extra, __authRetry: attempt },
        })
        .json();
      // 返回重放结果
      return ctx.resolve(replay);
    } catch (replayError) {
      // 这里的错误以及被归一化处理了，不需要再次进行归一化处理
      return ctx.reject(replayError as Error);
    }
  },
};

// 单实例：有 token 时附加 Bearer，401 由 refreshOn401 单飞刷新后重放；
// 登录/注册/刷新与 SSE 流等不适配 401 重放的请求通过 extra.skipAuthRefresh 跳过
export const http = hookFetch
  .create(baseOptions)
  .use(authHeader)
  .use(normalizeError)
  .use(unwrapEnvelope)
  .use(refreshOn401);

// 401 单飞刷新后重试一次（仅 SSE 流式使用）；刷新失败抛出的会话过期错误原样向上传递
export function retry401<T>(
  refresh: () => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  let retried = false;
  const attempt = async (): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (!retried && error instanceof ResponseError && error.status === 401) {
        retried = true;
        await refresh();
        return attempt();
      }
      throw error;
    }
  };
  return attempt();
}

let refreshPromise: Promise<AuthTokens> | null = null;

// 单飞刷新：并发 401 只触发一次刷新，其余请求复用同一次刷新结果
async function doRefresh(): Promise<AuthTokens> {
  // 获取长效token
  const { refreshToken } = authStore.get();
  // 无长效token，说明会话已过期，直接抛出错误
  if (!refreshToken) {
    handleSessionExpired();
    throw new ApiError('登录已过期，请重新登录');
  }
  try {
    // 调用获取短效token的接口
    const body: RefreshRequest = { refreshToken };
    const tokens = await http
      .post<AuthTokens>('auth/refresh', body, {
        extra: { skipAuthRefresh: true },
      })
      .json();
    // 存放长短效token
    applyTokens(tokens.accessToken, tokens.refreshToken);
    // 返回长短效token
    return tokens;
  } catch {
    handleSessionExpired();
    throw new ApiError('登录已过期，请重新登录');
  }
}

// 单飞：并发 401 只触发一次刷新，其余请求复用同一次刷新结果
export function refreshTokens(): Promise<AuthTokens> {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
