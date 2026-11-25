import type { CursorPageResult } from '@lucy/shared';
import type { InfiniteData } from '@tanstack/react-query';

/** 游标分页列表的缓存形态（useInfiniteQuery 的 data） */
export type CursorPages<T> = InfiniteData<CursorPageResult<T>>;

/** 条目改写：固定值，或按条目当前值计算（如点赞数增一） */
type ItemPatch<T> = Partial<T> | ((item: T) => Partial<T>);

/**
 * 就地改写无限列表缓存里指定 id 的条目。
 *
 * 未命中任何条目时返回**原引用**，避免无谓的订阅通知。
 * 非无限形态（无 data / 结构不符）原样返回。
 */
export function patchCursorPageItem<T extends { id: string }>(
  id: string,
  patch: ItemPatch<T>,
): (old: unknown) => unknown {
  return (old) => {
    const data = old as CursorPages<T> | undefined;
    if (!Array.isArray(data?.pages)) return old;

    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page.list.some((item) => item.id === id)) return page;
      changed = true;
      return {
        ...page,
        list: page.list.map((item) =>
          item.id === id
            ? {
                ...item,
                ...(typeof patch === 'function' ? patch(item) : patch),
              }
            : item,
        ),
      };
    });

    return changed ? { ...data, pages } : old;
  };
}

/** 从无限列表缓存每页中移除指定条目；未命中时返回原引用 */
export function removeCursorPageItem<T extends { id: string }>(
  id: string,
): (old: unknown) => unknown {
  return (old) => {
    const data = old as CursorPages<T> | undefined;
    if (!Array.isArray(data?.pages)) return old;

    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page.list.some((item) => item.id === id)) return page;
      changed = true;
      return { ...page, list: page.list.filter((item) => item.id !== id) };
    });

    return changed ? { ...data, pages } : old;
  };
}

/**
 * 按改写后的条目判定去留：`keep` 为真就地改写，否则从列表移除。
 *
 * 用于「写操作可能让条目不再满足当前筛选」的场景（如改名/改可见性）。
 * 未命中任何条目时返回原引用。
 */
export function patchOrRemoveCursorPageItem<T extends { id: string }>(
  id: string,
  keep: (next: T) => boolean,
  patch: Partial<T>,
): (old: unknown) => unknown {
  return (old) => {
    const data = old as CursorPages<T> | undefined;
    if (!Array.isArray(data?.pages)) return old;

    let changed = false;
    const pages = data.pages.map((page) => {
      if (!page.list.some((item) => item.id === id)) return page;
      changed = true;
      const list: T[] = [];
      for (const item of page.list) {
        if (item.id !== id) {
          list.push(item);
          continue;
        }
        const next = { ...item, ...patch };
        if (keep(next)) list.push(next);
      }
      return { ...page, list };
    });

    return changed ? { ...data, pages } : old;
  };
}
