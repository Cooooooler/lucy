/**
 * 把任意失败值转成可交给 pino `err` 字段的 Error 实例。
 *
 * 为什么不传归一化后的普通对象：pino 默认注册 `serializers.err`，会把带 `message`
 * 字符串的对象当成 Error 重新序列化——`type` 被改写成 `constructor.name`（普通对象即
 * `"Object"`），真实类名与 `cause` 丢失，按 `err.type` 聚合的目标反而失效。
 * 传原始 Error 并配合下面白名单化的 `serializeErrorForLog`，既保留真实类名与
 * cause 链，又不会把第三方错误上的 SQL / 绑定参数 / 响应体一并写进日志。
 */
export function toLoggableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : safeString(error));
}

/**
 * pino 的 `err` 序列化器（`pinoHttp.serializers.err`）。
 *
 * 为什么要自己实现：pino 默认序列化器（`pino-std-serializers/lib/err.js`）在
 * `for (const key in err)` 里把错误上**全部可枚举自有属性**展开输出。TypeORM 的
 * `QueryFailedError` 自带 `query`（原始 SQL）、`parameters`（绑定值，含用户提问与
 * 模型回答全文）、`driverError`；OpenAI 等 SDK 错误自带响应体回显。等于把 SQL 与
 * 用户内容写进日志，而 `redact` 覆盖不到这些动态路径。
 *
 * 这里白名单到 `type/message/stack`（外加递归的 `cause`）：既保住按 `err.type`
 * 聚合、保留根因链，又不会随第三方错误形状漂移而泄漏。序列化器输出即最终日志
 * 形状，pino 不会再用默认序列化器二次处理。
 */
export function serializeErrorForLog(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return {
    type: value.name,
    message: value.message,
    ...(value.stack ? { stack: value.stack } : {}),
    ...(value.cause instanceof Error
      ? { cause: serializeErrorForLog(value.cause) }
      : {}),
  };
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
