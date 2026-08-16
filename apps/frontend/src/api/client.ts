import type { ApiResponse } from '@lucy/shared';
import type { BodyType, HookFetchPlugin, RequestConfig } from 'hook-fetch';
import hookFetch, { ResponseError } from 'hook-fetch';
import { sseTextDecoderPlugin } from 'hook-fetch/plugins';
import { applyTokens, authStore, handleSessionExpired } from '../stores/auth';
import type { RefreshResult } from './types';

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

// 请求级扩展字段：
//   skipAuthRefresh  跳过 401 自动刷新（登录/注册/刷新/SSE 流等不适配重放）
//   __authRetry      记录 401 重放次数
type RequestExtra = {
  skipAuthRefresh?: boolean;
  __authRetry?: number;
};

// 基础配置：baseURL、Content-Type（hook-fetch 直接拼接 baseURL+url，baseURL 需以 / 结尾）
// withCredentials: hook-fetch 默认 credentials:'omit' 不携带 cookie；长效 token 走 HttpOnly
// cookie，必须显式带上，否则 /auth/refresh 收不到刷新令牌
const baseOptions = {
  baseURL: import.meta.env.DEV ? '/api/' : '/',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
};

const authHeader: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'auth-header',
  async beforeRequest(ctx) {
    ctx.config.headers = new Headers(ctx.config.headers);
    // accessToken 缺失时不主动预刷新：bootstrap 与 refreshOn401 已保证其可用，
    // 避免在登录页/匿名请求上无谓地触发刷新。
    const { accessToken } = authStore.get();
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

// 解包同时进行前后端约定错误处理
// 解包 { code, message, data } 信封；非 0 / 非 2xx 抛出 ApiError
const unwrapEnvelope: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
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
const refreshOn401: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
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
      // 调用刷新函数获取新的短效 token，并更新本地存储
      await refreshTokens();
    } catch (err) {
      // 401 已由 doRefresh 内部 handleSessionExpired 处理；瞬时错误原样抛出
      return ctx.reject(err as Error);
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
  .use(
    sseTextDecoderPlugin({
      json: true, // 自动解析 JSON
      prefix: 'data: ', // 移除 "data: " 前缀
      splitSeparator: '\n\n', // 事件分隔符
      trim: true, // 去除首尾空白
      doneSymbol: '[DONE]', // 结束标记，收到即终止流
    }),
  )
  .use(normalizeError)
  .use(unwrapEnvelope)
  .use(refreshOn401);

let refreshPromise: Promise<RefreshResult> | null = null;

// 单飞刷新：并发 401 只触发一次刷新，其余请求复用同一次刷新结果
async function doRefresh(): Promise<RefreshResult> {
  try {
    // 长效 token 在 HttpOnly cookie 里，浏览器自动携带，无需传 body
    const tokens = await http
      .post<RefreshResult>('auth/refresh', undefined, {
        extra: { skipAuthRefresh: true },
      })
      .json();
    applyTokens(tokens.accessToken);
    return tokens;
  } catch (err) {
    // 仅 401（会话真正过期）触发过期处理；网络/5xx 等瞬时错误原样抛出，不踢登录。
    // 注：hook-fetch 会把插件 reject 的错误克隆成基础 ResponseError，instanceof/code 不可靠，status 可靠
    if ((err as { status?: number }).status === 401) {
      handleSessionExpired();
      throw new ApiError('登录已过期，请重新登录');
    }
    throw err;
  }
}

export function refreshTokens(): Promise<RefreshResult> {
  refreshPromise ??= doRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
