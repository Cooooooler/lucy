/**
 * 从「该 mutation 是否在跑 + 它的 variables」取出正在处理的条目 id。
 *
 * 用于把路由持有的 mutation pending 态整理成网格的 `pendingIds`：
 * 删除类 mutation 的入参是 id 字符串，更新类是 `{ id, input }`，两种形态都要能取。
 */
export function pendingIdOf(
  isPending: boolean,
  variables: string | { id: string } | undefined,
): string | null {
  if (!isPending || !variables) return null;
  return typeof variables === 'string' ? variables : variables.id;
}
