/**
 * 转义 LIKE/ILIKE 模式里的通配符，返回可安全拼进 `%…%` 的字面量关键字。
 *
 * Postgres 的 LIKE/ILIKE 默认以 `\` 为转义符。不转义时，用户输入里的 `%` / `_` 会被当作
 * 通配符：`%` 命中全部行、`_` 命中任意单字符——搜索结果失真，且列表关键字那条长度上界
 * 也随之失去意义（一个 `%` 即退化为全表扫描）。`\` 自身必须最先转义，否则 `\%` 会被
 * 解析成「字面量 %」而不是「反斜杠 + 通配符」。
 *
 * 用法：`{ name: \`%${escapeLikePattern(input)}%\` }`。
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
