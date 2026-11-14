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

/** 白名单内的标量字段：是排障关键，且不会携带用户内容 */
const SAFE_ERROR_SCALARS = ['code', 'status', 'errno', 'syscall'] as const;

interface ErrorFieldSource {
  type?: unknown;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
  code?: unknown;
  status?: unknown;
  errno?: unknown;
  syscall?: unknown;
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
 * 两种输入形态都要处理（pino-http@11 的 `wrapErrorSerializer` 会先用默认序列化器
 * 把 Error 摊平成普通对象再交给自定义函数，请求上下文走的正是这条路）：
 * - 原始 `Error`：直接按白名单取值；
 * - 已序列化的普通对象：同样按白名单重建，其余键（query/parameters/driverError/
 *   response/raw…）一律丢弃。只靠 `instanceof Error` 判断会让请求内完全失效。
 *
 * 白名单：`type/message/stack` + 递归 `cause`，外加不含用户内容的标量
 * `code`（SQLSTATE/驱动错误码）/`status`/`errno`/`syscall`——线上区分
 * 「唯一键冲突 / 表不存在 / 连接被拒 / 供应商 429」只能靠它们。
 */
export function serializeErrorForLog(value: unknown): unknown {
  if (value instanceof Error) return pickErrorFields(value);
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as ErrorFieldSource).message === 'string'
  ) {
    return pickErrorFields(value);
  }
  return value;
}

function pickErrorFields(source: ErrorFieldSource): Record<string, unknown> {
  const type =
    typeof source.type === 'string'
      ? source.type
      : typeof source.name === 'string'
        ? source.name
        : 'Error';
  const picked: Record<string, unknown> = { type };
  if (typeof source.message === 'string') picked.message = source.message;
  if (typeof source.stack === 'string') picked.stack = source.stack;
  for (const key of SAFE_ERROR_SCALARS) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      picked[key] = value;
    }
  }
  const cause = source.cause;
  if (cause instanceof Error) {
    picked.cause = pickErrorFields(cause);
  } else if (cause !== null && typeof cause === 'object') {
    const fields = cause as ErrorFieldSource;
    if (typeof fields.type === 'string' || typeof fields.message === 'string') {
      picked.cause = pickErrorFields(fields);
    }
  }
  return picked;
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
