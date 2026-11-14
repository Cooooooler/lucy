/**
 * 把任意失败值转成可交给 pino `err` 字段的 Error 实例。
 *
 * 为什么不传归一化后的普通对象：pino 默认注册 `serializers.err`，会把带 `message`
 * 字符串的对象当成 Error 重新序列化——`type` 被改写成 `constructor.name`（普通对象即
 * `"Object"`），真实类名与 `cause` 丢失，按 `err.type` 聚合的目标反而失效。
 * 直接传原始 Error，pino 会原生输出 `type/message/stack` 并展开 cause。
 */
export function toLoggableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : safeString(error));
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
