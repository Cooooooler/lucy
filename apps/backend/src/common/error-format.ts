/**
 * 失败日志的结构化字段：与 pino 的 `err` 序列化约定一致（type/message/stack），
 * 采集端可直接按 `err.type` 聚合、按 `err.stack` 定位，不再依赖正则解析 message 文本。
 *
 * 包装错误把自己的根因挂在 `cause` 上，这里一并抽成嵌套字段（旧实现「优先取 cause 栈」
 * 是为了避免顶层包装栈淹没根因；结构化后两者都保留，采集端可按需取）。
 *
 * 两个失败出口（连接测试与 SSE 流）共用，避免格式各自漂移。
 */
export interface ErrorLogFields {
  type: string;
  message: string;
  stack?: string;
  cause?: Omit<ErrorLogFields, 'cause'>;
}

export function errorLogFields(error: unknown): ErrorLogFields {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: String(error) };
  }
  const cause = error.cause;
  return {
    type: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(cause instanceof Error
      ? {
          cause: {
            type: cause.name,
            message: cause.message,
            ...(cause.stack ? { stack: cause.stack } : {}),
          },
        }
      : {}),
  };
}
