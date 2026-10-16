import { useCallback, useState } from 'react';

/** 会话内视图状态：筛选条件 + 首可见项索引 */
export type ListViewState<TFilter> = {
  filter: TFilter;
  firstVisibleIndex: number;
};

/**
 * 建一份空视图状态：**必须在各列表页的模块作用域调用一次**（每页一份，互不干扰）。
 * 为什么不能建在 hook 工厂里，见 {@link useListViewState} 的说明。
 */
export function createListViewState<
  TFilter extends object,
>(): ListViewState<TFilter> {
  return { filter: {} as TFilter, firstVisibleIndex: 0 };
}

/** 复位：登出 / 会话过期时调用，避免下一个账号读到上一个账号的筛选与位置 */
export function resetListViewState<TFilter extends object>(
  store: ListViewState<TFilter>,
): void {
  store.filter = {} as TFilter;
  store.firstVisibleIndex = 0;
}

/**
 * 读写某一份视图状态：读取接口在挂载瞬间冻结。
 *
 * 状态只存活于当前 SPA 会话（F5 清空）——侧边栏入口指向的是不带 query 的路径，
 * 且约定「刷新后不恢复」，内存态与这两点都一致。
 *
 * 冻结的必要性：挂载初期虚拟化器会上报 index=0，若每次渲染都读 store，
 * 会把待恢复目标覆盖掉。
 *
 * ⚠️ `store` **必须由调用方在模块作用域持有**，不能是本 hook 所在工厂的局部变量。
 * 本项目的 React Compiler 会把「不依赖任何响应式值的回调」提升（outline）到模块作用域：
 * `useCallback(fn, [])` 若捕获了工厂局部的 `let state`，提升后的 `fn` 已经不在那个作用域里，
 * 运行时直接 `ReferenceError: state is not defined`（实测整页白屏，且 tsc / vitest 都发现不了，
 * 因为 vitest 走 SWC、不跑 Compiler）。把 store 作为**参数**传入后它就是一个响应式依赖，
 * 提升不再发生。
 */
export function useListViewState<TFilter extends object>(
  store: ListViewState<TFilter>,
) {
  const [initialFilter] = useState(() => store.filter);
  const [initialRestoreIndex] = useState(() => store.firstVisibleIndex);

  const saveFilter = useCallback(
    (patch: Partial<TFilter>) => {
      // 替换而非原地改写 filter：已冻结的快照不能被后续写入污染
      store.filter = { ...store.filter, ...patch };
    },
    [store],
  );

  const saveFirstVisibleIndex = useCallback(
    (index: number) => {
      if (store.firstVisibleIndex === index) return;
      store.firstVisibleIndex = index;
    },
    [store],
  );

  return {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  };
}
