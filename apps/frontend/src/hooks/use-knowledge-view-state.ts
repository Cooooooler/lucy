import type { KnowledgeBaseVisibility } from '@/api/types';
import {
  createListViewState,
  resetListViewState,
  useListViewState,
} from './create-list-view-state';

/** 视图筛选条件：与列表查询过滤条件同形，undefined 表示「不筛」 */
export type KnowledgeViewFilter = {
  name?: string;
  visibility?: KnowledgeBaseVisibility;
};

/** 知识库列表的会话内视图状态。store 必须建在模块作用域（原因见 useListViewState） */
const store = createListViewState<KnowledgeViewFilter>();

/**
 * 知识库列表的会话内视图状态（返回恢复的入口）。
 *
 * 之所以不落 URL / storage：侧边栏「知识库」入口指向不带 query 的 /knowledge，
 * 且约定「刷新后不恢复」——内存态与这两点都一致。
 */
export function useKnowledgeViewState() {
  return useListViewState(store);
}

/** 复位会话内视图状态（登出 / 会话过期时调用） */
export function resetKnowledgeViewState() {
  resetListViewState(store);
}
