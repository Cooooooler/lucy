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
