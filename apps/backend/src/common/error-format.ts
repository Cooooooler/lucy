/**
 * 失败日志的统一文本格式：`[错误类名] message`，再带上能定位根因的栈。
 *
 * - 类名：线上可按 `QueryFailedError` / `ModelCredentialError` 等类型聚合，区分
 *   「配置错」「平台密钥问题」与「供应商/基础设施故障」；
 * - 栈：包装错误把自己的根因挂在 `cause` 上（优先取 cause 栈）；普通错误没有 cause 时
 *   补自身栈——只记一句 message 看不出抛出位置，线上无法定位。
 *
 * 两个失败出口（连接测试与 SSE 流）共用，避免格式各自漂移。
 */
export function formatErrorForLog(error: unknown): string {
  if (!(error instanceof Error)) {
    return `[${typeof error}] ${String(error)}`;
  }
  const cause = error.cause;
  const detail =
    cause instanceof Error && cause.stack
      ? ` cause=${cause.stack}`
      : error.stack
        ? ` stack=${error.stack}`
        : '';
  return `[${error.name}] ${error.message}${detail}`;
}
