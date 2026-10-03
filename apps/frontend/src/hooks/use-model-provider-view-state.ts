import type { ModelProviderType } from '@/api/types';
import { useCallback, useState } from 'react';

/** 视图筛选条件：与列表查询过滤条件同形，undefined 表示「不筛」 */
export type ModelProviderViewFilter = {
  name?: string;
  type?: ModelProviderType;
};

type ModelProviderViewState = {
  filter: ModelProviderViewFilter;
  firstVisibleIndex: number;
};

// 模块级：仅存活于当前 SPA 会话（F5 清空）。
// 与知识库视图状态同策略：刷新不恢复，返回（SPA 路由）恢复筛选与首可见项。
let state: ModelProviderViewState = {
  filter: {},
  firstVisibleIndex: 0,
};

/**
 * 模型供应商列表的会话内视图状态。
 * 挂载瞬间冻结 initialFilter / initialRestoreIndex：挂载初期虚拟化器会上报 index=0，
 * 若每次渲染都读 store，会把待恢复目标覆盖掉。
 */
export function useModelProviderViewState() {
  const [initialFilter] = useState(() => state.filter);
  const [initialRestoreIndex] = useState(() => state.firstVisibleIndex);

  const saveFilter = useCallback((patch: ModelProviderViewFilter) => {
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
export function resetModelProviderViewState() {
  state = { filter: {}, firstVisibleIndex: 0 };
}
