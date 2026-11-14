/**
 * 把任意失败值转成可交给 pino `err` 字段的 Error 实例。
 *
 * 为什么不传归一化后的普通对象：pino 默认注册 `serializers.err`，会把带 `message`
 * 字符串的对象当成 Error 重新序列化——`type` 被改写成 `constructor.name`（普通对象即
 * `"Object"`），真实类名与 `cause` 丢失，按 `err.type` 聚合的目标反而失效。
 * 传原始 Error 并配合下面白名单化的 `serializeErrorForLog`，既保留真实类名与
 * cause 链，又不会把第三方错误上的 SQL / 绑定参数 / 响应体一并写进日志。
 *
 * 非 Error 值（HTTP 客户端/SDK 常以普通对象 reject）**不做整体序列化**：那会把
 * response/headers/请求参数（可能含用户内容或凭据）原样塞进 message；这里只拼
 * message 与安全标量，其余字段一律不进日志。原始 `name`/`type` 保留为
 * `originalType`（包装后的 type 恒为 `Error`，直接塞回 `name` 会与 pino-http 包装
 * 路径的 `constructor.name` 语义打架），且不伪造栈——栈顶只会指向本函数本身。
 */
export function toLoggableError(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new Error(describeUnknownError(error));
  // 不生成看似真实的栈：栈顶是本函数，排查时容易被误读成日志层抛错
  wrapped.stack = undefined;
  const originalType = originalErrorType(error);
  if (originalType) Object.assign(wrapped, { originalType });
  return wrapped;
}

/** 白名单内的标量字段：是排障关键，且不会携带用户内容 */
const SAFE_ERROR_SCALARS = [
  'code',
  'status',
  'status_code',
  'errno',
  'syscall',
] as const;

/** cause 链最大展开深度：与 `blockedErrorMessage` 一致，防止循环 cause 递归爆栈 */
const MAX_CAUSE_DEPTH = 4;

interface ErrorFieldSource {
  type?: unknown;
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  cause?: unknown;
  code?: unknown;
  status?: unknown;
  status_code?: unknown;
  errno?: unknown;
  syscall?: unknown;
  /** 非 Error 值包装前的原始类型名（见 `toLoggableError`） */
  originalType?: unknown;
  /** pino-std-serializers 默认序列化器留下的原始错误（请求上下文路径） */
  raw?: unknown;
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
 * 白名单：`type/message/stack` + 递归 `cause`（限深 4），外加不含用户内容的标量
 * `code`（SQLSTATE/驱动错误码）/`status`/`status_code`/`errno`/`syscall`——线上区分
 * 「唯一键冲突 / 表不存在 / 连接被拒 / 供应商 429」只能靠它们。
 */
export function serializeErrorForLog(value: unknown): unknown {
  if (value instanceof Error) return pickErrorFields(value, errorType(value));
  // 非 Error 对象同样按白名单重建：err 键上出现普通对象（SDK 响应体等）时不能原样透传
  if (value !== null && typeof value === 'object') {
    const source = value as ErrorFieldSource;
    const picked = pickErrorFields(
      source,
      typeof source.type === 'string' ? source.type : 'Object',
    );
    // 默认序列化器把 cause 并进了 message/stack，不输出 cause 键（原始错误留在 raw）。
    // 结构化 cause 仍有排障价值（其中的 code/SQLSTATE），从 raw 按同一白名单恢复一层。
    if (!picked.cause && source.raw instanceof Error) {
      const cause = pickCause(source.raw.cause, 1);
      if (cause) picked.cause = cause;
    }
    return picked;
  }
  // 原始标量（string/number）原样输出，不带结构化内容
  return value;
}

/**
 * 原始 Error 的 `type`：与 pino-http 包装路径严格对齐。
 * 包装路径用的是默认序列化器的 `constructor.name`，这里照抄同一规则
 * （构造器是函数时取构造器名，否则退 `name`），否则同一错误在两条路径下
 * `err.type` 不同，按类名聚合会漏。
 */
function errorType(value: Error): string {
  const ctor = value.constructor;
  if (typeof ctor === 'function' && ctor.name) return ctor.name;
  return value.name || 'Error';
}

function pickErrorFields(
  source: ErrorFieldSource,
  type: string,
  depth = 0,
): Record<string, unknown> {
  const picked: Record<string, unknown> = { type };
  if (typeof source.message === 'string') picked.message = source.message;
  if (typeof source.stack === 'string') picked.stack = source.stack;
  if (typeof source.originalType === 'string') {
    picked.originalType = source.originalType;
  }
  for (const key of SAFE_ERROR_SCALARS) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      picked[key] = value;
    }
  }
  if (depth >= MAX_CAUSE_DEPTH) return picked;
  const cause = pickCause(source.cause, depth + 1);
  if (cause) picked.cause = cause;
  return picked;
}

function pickCause(
  cause: unknown,
  depth: number,
): Record<string, unknown> | undefined {
  if (cause instanceof Error) {
    return pickErrorFields(cause, errorType(cause), depth);
  }
  if (cause !== null && typeof cause === 'object') {
    const fields = cause as ErrorFieldSource;
    if (typeof fields.type === 'string' || typeof fields.message === 'string') {
      return pickErrorFields(
        fields,
        typeof fields.type === 'string' ? fields.type : 'Error',
        depth,
      );
    }
  }
  return undefined;
}

/** 非 Error 值的原始类型名（`name` 或 `type`），用于保留聚合键 */
function originalErrorType(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const source = value as ErrorFieldSource;
  if (typeof source.name === 'string' && source.name) return source.name;
  if (typeof source.type === 'string' && source.type) return source.type;
  return undefined;
}

/** 非 Error 值的可读摘要：只取 message 与安全标量，绝不整体序列化对象 */
function describeUnknownError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value === null || value === undefined) return String(value);
  const source = value as ErrorFieldSource;
  const parts: string[] = [];
  if (typeof source.message === 'string') parts.push(source.message);
  for (const key of SAFE_ERROR_SCALARS) {
    const scalar = source[key];
    if (typeof scalar === 'string' || typeof scalar === 'number') {
      parts.push(`${key}=${scalar}`);
    }
  }
  return parts.length > 0 ? parts.join(' ') : 'unknown error';
}
