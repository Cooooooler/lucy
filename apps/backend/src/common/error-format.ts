/**
 * 失败日志的统一文本格式：`[错误类名] message`，包装错误再带上 `cause` 的栈。
 *
 * - 类名：线上可按 `QueryFailedError` / `ModelCredentialError` 等类型聚合，区分
 *   「配置错」「平台密钥问题」与「供应商/基础设施故障」；
 * - cause 栈：包装错误把自己挂在 `cause` 上，只记外层 message 会让根因永远进不了日志。
 *
 * 两个失败出口（连接测试与 SSE 流）共用，避免格式各自漂移。
 */
export function formatErrorForLog(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  return `[${name}] ${message}${
    cause instanceof Error && cause.stack ? ` cause=${cause.stack}` : ''
  }`;
}
