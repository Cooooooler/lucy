import type { KnowledgeBaseVisibility } from '@/api/types';
import { useCallback, useState } from 'react';

/** 视图筛选条件：与列表查询过滤条件同形，undefined 表示「不筛」 */
export type KnowledgeViewFilter = {
  name?: string;
  visibility?: KnowledgeBaseVisibility;
};

type KnowledgeViewState = {
  filter: KnowledgeViewFilter;
  firstVisibleIndex: number;
};

// 模块级：仅存活于当前 SPA 会话（F5 清空）。
// 之所以不落 URL / storage，是因为侧边栏「知识库」入口指向不带 query 的 /knowledge，
// 且约定「刷新后不恢复」——内存态与这两点都一致。
let state: KnowledgeViewState = {
  filter: {},
  firstVisibleIndex: 0,
};

/**
 * 知识库列表的会话内视图状态。
 * 挂载瞬间冻结 initialFilter / initialRestoreIndex：挂载初期虚拟化器会上报 index=0，
 * 若每次渲染都读 store，会把待恢复目标覆盖掉。
 */
export function useKnowledgeViewState() {
  const [initialFilter] = useState(() => state.filter);
  const [initialRestoreIndex] = useState(() => state.firstVisibleIndex);

  const saveFilter = useCallback((patch: KnowledgeViewFilter) => {
    state = { ...state, filter: { ...state.filter, ...patch } };
  }, []);

  const saveFirstVisibleIndex = useCallback((index: number) => {
    if (state.firstVisibleIndex === index) return;
    state = { ...state, firstVisibleIndex: index };
  }, []);

  return {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  };
}

/** 复位会话内视图状态（登出 / 会话过期时调用，避免下一个账号读到上一个账号的筛选与位置） */
export function resetKnowledgeViewState() {
  state = { filter: {}, firstVisibleIndex: 0 };
}
