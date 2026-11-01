import { BaseUrlBlockedError } from './base-url-blocked.error.js';
import { PROVIDER_ERROR_MESSAGES, type ProviderErrorKind } from './messages.js';

/**
 * 把供应商/网络错误归类（纯函数）：连接测试与对话链路共用同一判据与文案，
 * 避免「同一把 Key 在连接测试里报无效、在聊天里报生成失败」这类归因漂移。
 *
 * 只认结构化 `status` 与常见网络错误字样；其余返回 null，交给调用方兜底。
 */
export function providerErrorKind(error: unknown): ProviderErrorKind | null {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 429) return 'rateLimited';
  if (typeof status === 'number' && status >= 500) return 'serverError';
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|fetch failed|network/i.test(
      `${name} ${message}`,
    )
  ) {
    return 'network';
  }
  return null;
}

/** 供应商/网络错误的可执行文案；不属于该类时返回 null */
export function providerErrorMessage(error: unknown): string | null {
  const kind = providerErrorKind(error);
  return kind ? PROVIDER_ERROR_MESSAGES[kind] : null;
}

/**
 * 沿 SDK 包装错误的 `cause` 链找出 Base URL 守卫抛出的可执行文案。
 *
 * OpenAI/Anthropic SDK 会把自定义 fetch 的异常包成 APIConnectionError（原错误在
 * `cause` 上），LangChain 也可能再包一层；不沿链找，用户只会看到兜底的「连接失败」，
 * 看不到「指向受限地址 / 拒绝跟随重定向」。连接测试与对话链路共用这一处提取逻辑。
 */
export function blockedErrorMessage(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof BaseUrlBlockedError) return current.message;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
