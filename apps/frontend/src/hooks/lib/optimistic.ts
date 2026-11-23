import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * 一次乐观改写：`queryKey` 命中哪些缓存就改哪些。
 *
 * `apply` 必须是纯函数，只依赖旧数据、入参与命中的 key；返回 `undefined` 表示
 * 这份缓存不参与本次改写（数据本就不存在时原样跳过，不会把它写成 undefined）。
 */
export type CachePatch<TVars> = {
  queryKey: QueryKey;
  /** 只命中完全相同的 key（详情类）；默认按前缀匹配（列表类） */
  exact?: boolean;
  apply: (old: unknown, vars: TVars, queryKey: QueryKey) => unknown | undefined;
};

/**
 * 乐观更新协议：取消在途查询 → 快照命中的缓存 → 就地改写，返回回滚函数。
 *
 * - 必须先 cancel：否则在途响应会在乐观写入之后覆盖它。
 * - 回滚只恢复本次 patch 命中的 key，不会碰其它缓存。
 * - 同一份列表上并发写多个条目时，后失败那次的快照回滚会连带撤销先前的乐观写入
 *   （快照是整份数组）。因此失败路径除了回滚，还应失效一次让缓存收敛到服务端真相，
 *   见 use-knowledge 里的 onError。
 */
export async function applyOptimistic<TVars>(
  queryClient: QueryClient,
  patches: CachePatch<TVars>[],
  vars: TVars,
): Promise<() => void> {
  await Promise.all(
    patches.map((patch) =>
      queryClient.cancelQueries({
        queryKey: patch.queryKey,
        exact: patch.exact,
      }),
    ),
  );

  const snapshot: Array<[QueryKey, unknown]> = [];
  for (const patch of patches) {
    const entries = queryClient.getQueriesData({
      queryKey: patch.queryKey,
      exact: patch.exact,
    });
    for (const [key, old] of entries) {
      snapshot.push([key, old]);
      const next = patch.apply(old, vars, key);
      if (next !== undefined) queryClient.setQueryData(key, next);
    }
  }

  return () => {
    for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
  };
}
