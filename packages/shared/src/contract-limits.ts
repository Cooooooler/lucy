/**
 * 前后端共用的契约边界常量——后端校验装饰器、Swagger 文档选项、前端 zod 规则与
 * 强度指示共用同一份。
 *
 * 为什么放这里：这些边界此前各自写一份，已经出现过「只改一半」的实际故障——
 * 后端把密码「特殊字符」从 ASCII 白名单放宽为符号判据，前端 zod 仍是旧白名单，
 * 于是 `Str0ng-Pass` 在前端就被拦下，用户根本到不了后端。同一份常量两端复用时，
 * 边界只会随契约一起变。
 */

/** 用户名字符集：仅字母数字下划线连字符（无前瞻，可安全下发给任意正则引擎） */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

/** 昵称长度（可选项，上界与用户名的 50 相同但语义独立） */
export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 50;

/**
 * 邮箱上界与 `users.email` 列（`varchar(255)`）对齐。
 * validator.js 的 `isEmail` 只约束局部 ≤64、域名 ≤253 字节，整串可达 ~318，
 * 落在 256–318 的邮箱能过 DTO 却会在插入时报 `22001 value too long`（500 而不是 400）。
 */
export const EMAIL_MAX_LENGTH = 255;

/** 登录 account 为「用户名或邮箱」二选一，取两者上界的较大者（email 的 255） */
export const LOGIN_ACCOUNT_MAX_LENGTH = 255;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

/**
 * 密码四项要素的判据。`symbol` 是「非字母、非数字、非控制/格式、非分隔符」——
 * 只放行符号与标点：空格、制表符、零宽空格（U+200B）、BOM 既不可见又不像用户心中的
 * 「特殊字符」，汉字（`\p{L}`）同理，都不该用来凑齐强度要求。
 */
export const PASSWORD_RULES = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  digit: /\d/,
  symbol: /[^\p{L}\p{N}\p{C}\p{Z}]/u,
} as const;

/**
 * 组合后的完整密码约束（后端 `@Matches` 用）：四项要素各一个前瞻，且首尾不接受空白。
 * 由 {@link PASSWORD_RULES} 拼装，谓词语义与前端逐项校验同源。
 *
 * 两个易错细节：
 * - 前瞻用 `[\s\S]*` 而非 `.*`：JS 的 `.` 不匹配换行，密码内部的换行会把串切成两段，
 *   位于换行之后的符号/大写/小写/数字都看不见，`Aa1\nPass!` 会误报「需包含符号」；
 * - 首尾非空白（`\S…\S`）而不是 `@Transform(trim)`：trim 会静默把待验证凭据换成另一个
 *   字符串，而旧版正则没有 `$` 锚定、放行过含首尾空白的密码并原样哈希，登录侧一旦也
 *   trim，那些存量账号将永远 401（本仓库没有改密入口）。
 */
export const PASSWORD_PATTERN = new RegExp(
  `^(?=[\\s\\S]*${PASSWORD_RULES.lowercase.source})` +
    `(?=[\\s\\S]*${PASSWORD_RULES.uppercase.source})` +
    `(?=[\\s\\S]*${PASSWORD_RULES.digit.source})` +
    `(?=[\\s\\S]*${PASSWORD_RULES.symbol.source})` +
    `\\S(?:[\\s\\S]*\\S)?$`,
  'u',
);

/** 会话标题：后端 DTO 校验与前端重命名输入框共用（前端此前写 100，51–100 字符必然被后端 400） */
export const CONVERSATION_TITLE_MIN_LENGTH = 1;
export const CONVERSATION_TITLE_MAX_LENGTH = 50;

/** 消息内容上界：后端 DTO 与前端发送框共用 */
export const MESSAGE_CONTENT_MIN_LENGTH = 1;
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;

/** 会话/消息的可选模型名上界 */
export const MODEL_NAME_MAX_LENGTH = 100;

/** 列表模糊匹配关键字上界：ILIKE 谓词走不了索引，超长输入是廉价的全表扫描放大器 */
export const KNOWLEDGE_KEYWORD_MAX_LENGTH = 100;
