import {
  API_VERSION as API_VERSION_CODE,
  ErrorCode,
  type ApiResponse,
} from '@lucy/shared';
import type { BodyType, HookFetchPlugin, RequestConfig } from 'hook-fetch';
import hookFetch, { ResponseError } from 'hook-fetch';
import { sseTextDecoderPlugin } from 'hook-fetch/plugins';
import { applyTokens, authStore, handleSessionExpired } from '../stores/auth';
import { emitApiSuccessMessage } from './messages';
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

/**
 * 取请求错误的可展示文案（`message.error` / `Result` 副标题等）。
 *
 * **不要用 `err instanceof ApiError` 判定**：hook-fetch 会把插件 reject 的错误克隆成
 * 基础 `ResponseError`（同 `doRefresh` 处的说明），类身份在浏览器里会丢失——实测克隆后
 * `instanceof ApiError` 为 false，而 `name`/`message`/`status`/`code` 都还在。
 * 依赖 `instanceof` 会让分支永远走不进去，用户只能看到兜底文案（后端的具体原因被吞掉）。
 *
 * 判定仍要求 `name === 'ApiError'`：只有服务端给出的业务文案才直接展示，
 * 网络中断、脚本异常这类技术错误一律走兜底文案（保持原有语义）。
 */
export function errorMessageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.name === 'ApiError' && err.message) {
    return err.message;
  }
  return fallback;
}

/**
 * 取请求错误的 HTTP 状态码（取不到返回 undefined）。
 * 同上：判定依据是字段而非类身份；克隆后 `status` 仍可靠。
 */
export function errorStatusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

// 请求级扩展字段：
//   skipAuthRefresh  跳过 401 自动刷新（登录/注册/刷新/SSE 流等不适配重放）
//   skipSuccessMessage  跳过成功提示广播（后台刷新、点赞等高频/静默请求）
//   __authRetry      记录 401 重放次数
type RequestExtra = {
  skipAuthRefresh?: boolean;
  skipSuccessMessage?: boolean;
  __authRetry?: number;
};

// API 版本前缀：默认由后端共享的主版本号派生（v1），保证前后端不会各写一份而漂移；
// 特殊环境可用 VITE_API_VERSION 整体覆盖（如灰度期间指向 v2）。
const API_VERSION = import.meta.env.VITE_API_VERSION ?? `v${API_VERSION_CODE}`;

// 基础配置：baseURL、Content-Type（hook-fetch 直接拼接 baseURL+url，baseURL 需以 / 结尾）
// withCredentials: hook-fetch 默认 credentials:'omit' 不携带 cookie；长效 token 走 HttpOnly
// cookie，必须显式带上，否则 /auth/refresh 收不到刷新令牌。
// baseURL 解析顺序：
// 1. globalThis.__lucyApiBaseUrl（测试 setupFiles 注入，覆盖 dev/prod 默认）
// 2. VITE_API_BASE_URL 构建期注入（CI/CD 不同环境部署用）
// 3. dev 默认 '/api/{version}/'（vite proxy 转发），prod 同源 '{version}/'
const baseOptions = {
  baseURL:
    (globalThis as { __lucyApiBaseUrl?: string }).__lucyApiBaseUrl ??
    import.meta.env.VITE_API_BASE_URL ??
    (import.meta.env.DEV ? `/api/${API_VERSION}/` : `/${API_VERSION}/`),
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

// multipart/form-data：去除默认的 application/json Content-Type，
// 让 fetch 为 FormData body 自动生成 boundary（库上传等文件接口依赖）
const multipartFormData: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'multipart-form-data',
  async beforeRequest(ctx) {
    if (ctx.config.data instanceof FormData) {
      ctx.config.headers = new Headers(ctx.config.headers);
      ctx.config.headers.delete('Content-Type');
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
    if (body && body.code !== ErrorCode.OK) {
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
// 解包 { code, message, data } 信封；非 OK / 非 2xx 抛出 ApiError。
// 成功时把后端 message 广播给 ApiMessageBridge：文案与出现时机都由后端决定，
// 前端只展示。仅变更方法（POST/PUT/PATCH/DELETE）广播，'ok'（查询类）与静默请求不广播。
const unwrapEnvelope: HookFetchPlugin<ApiResponse<unknown>, RequestExtra> = {
  name: 'unwrap-envelope',
  afterResponse(ctx) {
    if (ctx.responseType !== 'json') return ctx;
    // 204 No Content 无响应体，直接放行（如 like/unlike 等幂等操作）
    if (ctx.response.status === 204) return ctx;
    const body = ctx.result;
    // 2xx 但业务码非 OK（防御性处理）：仍按错误处理，还原业务码与 message
    if (body.code !== ErrorCode.OK) {
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
    emitSuccessMessage(ctx.config.method, ctx.config.extra, body.message);
    ctx.result = body.data as never;
    return ctx;
  },
};

/** 变更方法 + 非 'ok' message + 未静默 → 广播成功提示 */
function emitSuccessMessage(
  method: string | undefined,
  extra: RequestExtra | undefined,
  message: unknown,
): void {
  if (extra?.skipSuccessMessage) return;
  if (
    method !== 'POST' &&
    method !== 'PUT' &&
    method !== 'PATCH' &&
    method !== 'DELETE'
  ) {
    return;
  }
  if (typeof message !== 'string' || !message || message === 'ok') return;
  emitApiSuccessMessage(message);
}

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
  .use(multipartFormData)
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
        // 后台静默换发：既不触发 401 重放，也不弹「令牌已刷新」提示
        extra: { skipAuthRefresh: true, skipSuccessMessage: true },
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
