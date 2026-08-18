/**
 * 生成 Redis Cluster 散列槽标签：把 key 包进 `{}`，
 * 使共享同一标签的相关 key 路由到同一槽位（如 `user:{123}:profile`、`user:{123}:sessions`）。
 */
export function hashTag(key: string): string {
  return `{${key}}`;
}
