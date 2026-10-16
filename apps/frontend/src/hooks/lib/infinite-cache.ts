import type { CursorPageResult } from '@lucy/shared';
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
  UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * 游标分页无限列表的缓存工具。
 *
 * 所有「一页 list + nextCursor」形态的列表页共用同一套缓存操作：形态只有
 * `{ pages: CursorPageResult<T>[], pageParams }` 一种（offset 形态已随游标分页一并移除），
 * 无需再兼容多形态。此前知识库与模型供应商的 hook 各抄了一份，抄写期间已经漂移
 * （过滤条件一个按写死的下标取、一个按末位取；两个「应当同策略」的无限列表一个
 * `staleTime: Infinity` 一个 `0`，后者换筛选时会重放已加载的分页）。
 */

/** 无限查询缓存形态：`{ pages, pageParams }` */
export type InfinitePages<T> = {
  pages: CursorPageResult<T>[];
  pageParams: unknown[];
};

/** {@link snapshotLists} 的结果形态：`[queryKey, data][]` */
export type ListsSnapshot = ReadonlyArray<[QueryKey, unknown]>;

/** 条目的列表 key 前缀与详情 key：各模块的 key 工厂只需提供这两个 */
export type ListCacheKeys = {
  /** 列表失效前缀（不含过滤条件），命中该模块下所有筛选条件的列表查询 */
  listAll: QueryKey;
  /** 单条详情 key */
  item: QueryKey;
};

/** 对无限查询缓存中每一页的 list 做映射；非无限形态原样返回 */
export function mapPages<T extends { id: string }>(
  old: unknown,
  mapper: (item: T) => T,
): unknown {
  if (!old || typeof old !== 'object') return old;
  const data = old as { pages?: unknown };
  if (!Array.isArray(data.pages)) return old;
  return {
    ...data,
    pages: (data.pages as unknown[]).map((page) => {
      if (!page || typeof page !== 'object') return page;
      const p = page as { list?: unknown };
      if (!Array.isArray(p.list)) return page;
      return { ...p, list: (p.list as T[]).map(mapper) };
    }),
  };
}

/** 在无限查询缓存中按 id 查找条目 */
export function findInPages<T extends { id: string }>(
  old: unknown,
  id: string,
): T | undefined {
  if (!old || typeof old !== 'object') return undefined;
  const data = old as { pages?: unknown };
  if (!Array.isArray(data.pages)) return undefined;
  for (const page of data.pages as unknown[]) {
    if (!page || typeof page !== 'object') continue;
    const list = (page as { list?: unknown }).list;
    if (!Array.isArray(list)) continue;
    const found = (list as T[]).find((item) => item.id === id);
    if (found) return found;
  }
  return undefined;
}

/** 从无限查询缓存的每页 list 中剔除指定条目 */
export function filterOutItem<T extends { id: string }>(
  old: unknown,
  id: string,
): unknown {
  if (!old || typeof old !== 'object') return old;
  const data = old as { pages?: unknown };
  if (!Array.isArray(data.pages)) return old;
  return {
    ...data,
    pages: (data.pages as unknown[]).map((page) => {
      if (!page || typeof page !== 'object') return page;
      const p = page as { list?: unknown };
      if (!Array.isArray(p.list)) return page;
      return {
        ...p,
        list: (p.list as T[]).filter((item) => item.id !== id),
      };
    }),
  };
}

/** 快照所有列表缓存（乐观更新回滚用） */
export function snapshotLists(
  queryClient: QueryClient,
  listAll: QueryKey,
): ListsSnapshot {
  return queryClient.getQueriesData<unknown>({ queryKey: listAll });
}

/** 回滚到 {@link snapshotLists} 拍下的快照 */
export function rollbackToSnapshot(
  queryClient: QueryClient,
  snapshot: ListsSnapshot | undefined,
) {
  for (const [key, data] of snapshot ?? []) {
    queryClient.setQueryData(key, data);
  }
}

/** 统一更新条目缓存：详情 + 所有列表分页（乐观更新，不触发 refetch） */
export function patchItemInCache<T extends { id: string }>(
  queryClient: QueryClient,
  keys: ListCacheKeys,
  id: string,
  patch: Partial<T>,
) {
  queryClient.setQueryData<T>(keys.item, (old) =>
    old ? { ...old, ...patch } : old,
  );
  queryClient.setQueriesData({ queryKey: keys.listAll }, (old) =>
    mapPages<T>(old, (item) => (item.id === id ? { ...item, ...patch } : item)),
  );
}

/** 详情优先、列表兜底地查找条目 */
export function findItemInCache<T extends { id: string }>(
  queryClient: QueryClient,
  keys: ListCacheKeys,
  id: string,
): T | undefined {
  const detail = queryClient.getQueryData<T>(keys.item);
  if (detail) return detail;
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: keys.listAll,
  })) {
    const found = findInPages<T>(data, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * 把新建条目插入每个匹配过滤条件的列表首页顶部（乐观新增，不触发 refetch）。
 *
 * 过滤条件取列表 key 的**最末元素**：key 的构造约定是 `[...listAll(), query]`，
 * 按末位取不会因为前缀里多一层分组（如知识库的 `bases` 段）而静默取错下标。
 */
export function prependToMatchingLists<T extends { id: string }>(
  queryClient: QueryClient,
  listAll: QueryKey,
  created: T,
  isInFilter: (item: T, filter: unknown) => boolean,
) {
  const queries = queryClient.getQueryCache().findAll({ queryKey: listAll });
  for (const query of queries) {
    const filter = query.queryKey.at(-1);
    if (!isInFilter(created, filter)) continue;
    queryClient.setQueryData(query.queryKey, (old: unknown) => {
      if (!old || typeof old !== 'object') return old;
      const data = old as InfinitePages<T>;
      if (!Array.isArray(data.pages) || data.pages.length === 0) return old;
      const [first, ...rest] = data.pages;
      return {
        ...data,
        pages: [{ ...first, list: [created, ...first.list] }, ...rest],
      };
    });
  }
}

export type UseCursorListOptions<T> = {
  /** 列表 key：携带过滤条件与每页条数（游标由 useInfiniteQuery 管理，不入 key） */
  queryKey: QueryKey;
  /** 取一页；cursor 为 undefined 表示首页 */
  fetchPage: (cursor: string | undefined) => Promise<CursorPageResult<T>>;
  enabled?: boolean;
  /**
   * 已缓存数据的保鲜期，默认 `Infinity`。
   *
   * 不是随手写的乐观值，堵的是「换筛选」这条路径：换筛选是在同一个 observer 上换
   * queryKey，`QueryObserver.setOptions` 走的是 `shouldFetchOptionally`——只要新 query
   * 的缓存已过期（staleTime 0 恒过期）就 refetch，而 `useInfiniteQuery` 的 refetch 会把
   * 已加载的分页从头重放一遍（几页就几次请求）。`refetchOnMount`/`refetchOnReconnect`
   * 只覆盖挂载/重连，管不到 setOptions 这条，于是「切回已看过的筛选」也会重放历史分页。
   * Infinity 后无缓存的新条件（`data === undefined` 仍判定为过期）照常请求首页，
   * 缓存寿命交给默认 gcTime(5min) 回收。
   */
  staleTime?: number;
  /**
   * 换筛选时用上一组条件的数据占位，默认 true：列表保持可见，不再「整块骨架 → 整格重挂」，
   * 虚拟网格与已挂卡片实例得以沿用。占位期间 `isPlaceholderData` 为 true——占位页携带的是
   * **旧条件**的 nextCursor，触底预取必须停手（见 `use-virtual-grid`）。
   */
  keepPreviousData?: boolean;
};

/**
 * 「换筛选时沿用上一组数据」的占位函数。
 *
 * 提到模块级的原因：若内联写成 `(prev) => prev`，每轮渲染都会产生新引用并进入
 * `useInfiniteQuery` 的 options，于是每次渲染都要重算一次 options——本文件与同目录的 hook
 * 都在强调引用稳定的重要性（见 `useResetListCache` 为何收 key 工厂那段），这里同理。
 */
const keepPreviousPage = <T>(
  prev: InfiniteData<CursorPageResult<T>> | undefined,
) => prev;

/**
 * 游标分页无限列表：所有列表页共用同一套 options。
 * 保留默认 gcTime(5min)：离开 ≤5min 返回命中缓存，>5min 缓存回收后从首页重来；
 * 用 `refetchOnMount`/`refetchOnReconnect` 阻止重挂载与断网重连时重放历史分页。
 */
export function useCursorList<T>({
  queryKey,
  fetchPage,
  enabled = true,
  staleTime = Infinity,
  keepPreviousData = true,
}: UseCursorListOptions<T>): UseInfiniteQueryResult<
  InfiniteData<CursorPageResult<T>>,
  Error
> {
  const placeholderData = keepPreviousData ? keepPreviousPage : undefined;
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchPage((pageParam as string | null) ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime,
    placeholderData,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    enabled,
  });
}

/**
 * 手动「刷新」：丢弃**所有筛选条件**的分页缓存，并让当前可见的筛选从第一页重新加载。
 *
 * 用 `resetQueries` 而非 `invalidateQueries`：invalidate 会把 `useInfiniteQuery` 的整段缓存
 * 标记过期并 refetch，等于把已加载的分页从头重放（几页就几次请求，正是换筛选时踩过的坑）；
 * reset 先把匹配的缓存全部清空，再只 refetch `type: 'active'` 的查询——因此只有当前筛选
 * 重新取第一页（1 次请求），其它筛选的缓存一并作废、下次进入同样从第一页开始。
 *
 * 传入 key **工厂**而非 key 本身：key 数组每次调用都是新引用，直接进依赖数组会让回调每轮重建。
 */
export function useResetListCache(listAll: () => QueryKey) {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.resetQueries({ queryKey: listAll() }),
    [queryClient, listAll],
  );
}
