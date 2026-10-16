import type { ModelProviderType } from '@/api/types';
import {
  createListViewState,
  resetListViewState,
  useListViewState,
} from './create-list-view-state';

/** 视图筛选条件：与列表查询过滤条件同形，undefined 表示「不筛」 */
export type ModelProviderViewFilter = {
  name?: string;
  type?: ModelProviderType;
};

/** 模型供应商列表的会话内视图状态。store 必须建在模块作用域（原因见 useListViewState） */
const store = createListViewState<ModelProviderViewFilter>();

/**
 * 模型供应商列表的会话内视图状态（返回恢复的入口）。
 * 与知识库视图状态同策略：刷新不恢复，返回（SPA 路由）恢复筛选与首可见项。
 */
export function useModelProviderViewState() {
  return useListViewState(store);
}

/** 复位会话内视图状态（登出 / 会话过期时调用） */
export function resetModelProviderViewState() {
  resetListViewState(store);
}
