/**
 * 生成 Redis Cluster 散列槽标签：把 key 包进 `{}`，
 * 使共享同一标签的相关 key 路由到同一槽位（如 `user:{123}:profile`、`user:{123}:sessions`）。
 * 空 key 或含花括号的 key 会生成无效/歧义标签，抛 TypeError 拒绝。
 */
export function hashTag(key: string): string {
  if (key.length === 0) {
    throw new TypeError('hashTag: key must not be empty');
  }
  if (key.includes('{') || key.includes('}')) {
    throw new TypeError('hashTag: key must not contain braces');
  }
  return `{${key}}`;
}
