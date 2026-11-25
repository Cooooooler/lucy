import {
  createModelProviderApi,
  deleteModelProviderApi,
  getModelProviderApi,
  getModelProviderDefaultsApi,
  listModelProvidersApi,
  testModelProviderConnectionApi,
  updateModelProviderApi,
  updateModelProviderDefaultsApi,
} from '@/api/model-provider';
import type {
  CreateModelProviderRequest,
  ModelProvider,
  ModelProviderType,
  ModelProviderVendor,
  UpdateModelProviderRequest,
} from '@/api/types';
import type { ModelProviderListQuery } from '@lucy/shared';
import {
  type QueryClient,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { type CachePatch, applyOptimistic } from './lib/optimistic';
import {
  patchCursorPageItem,
  patchOrRemoveCursorPageItem,
  removeCursorPageItem,
} from './lib/query-shapes';

/** 默认每页条数（游标分页，同时是列表 queryKey 的一部分） */
export const MODEL_PROVIDER_PAGE_SIZE = 20;

/** 模型列表过滤条件（游标/每页条数由 hook 管理，不暴露给调用方） */
export type ModelProviderListFilter = {
  name?: string;
  type?: ModelProviderType;
  vendor?: ModelProviderVendor;
};

/** 查询 key 工厂，统一管理 queryKey 生成逻辑 */
export const modelProviderKeys = {
  all: ['model-provider'] as const,
  /** 列表失效前缀：只命中列表查询 */
  listAll: () => [...modelProviderKeys.all, 'list'] as const,
  list: (query: ModelProviderListQuery = {}) =>
    [...modelProviderKeys.listAll(), query] as const,
  /** 默认模型设置（每种类型一条） */
  defaults: () => [...modelProviderKeys.all, 'defaults'] as const,
  item: (id: string) => [...modelProviderKeys.all, id] as const,
};

// ==== 乐观更新 ============================================================

type UpdateVariables = {
  id: string;
  input: UpdateModelProviderRequest;
};

/** 写回缓存：详情（精确 key）+ 所有筛选条件的列表分页（前缀），不触发 refetch */
function patchModelInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<ModelProvider>,
) {
  queryClient.setQueryData<ModelProvider>(modelProviderKeys.item(id), (old) =>
    old?.id === id ? { ...old, ...patch } : old,
  );
  queryClient.setQueriesData(
    { queryKey: modelProviderKeys.listAll() },
    patchCursorPageItem<ModelProvider>(id, patch),
  );
}

/** 列表 key 约定为 [...listAll(), 查询参数]（见 modelProviderKeys.list） */
function listFilterOf(queryKey: QueryKey): ModelProviderListQuery | undefined {
  return queryKey.at(-1) as ModelProviderListQuery | undefined;
}

/** 改写后的条目是否仍能满足列表筛选（name 为后端 ILIKE 的子串匹配） */
function matchesListFilter(
  filter: ModelProviderListQuery | undefined,
  item: Pick<ModelProvider, 'name' | 'type' | 'vendor'>,
) {
  if (filter?.type && filter.type !== item.type) return false;
  if (filter?.vendor && filter.vendor !== item.vendor) return false;
  return !(
    filter?.name && !item.name.toLowerCase().includes(filter.name.toLowerCase())
  );
}

/**
 * 编辑表单提交的字段（后端 UpdateModelProviderDto）。
 * 刻意不含 apiKey：明文只随请求发送，绝不进入任何缓存。
 */
function updateFields(
  input: UpdateModelProviderRequest,
): Partial<ModelProvider> {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
    ...(input.contextLength !== undefined
      ? { contextLength: input.contextLength }
      : {}),
  };
}

/**
 * 编辑：详情就地改写，列表按改写后的 name/type/vendor 重新判断是否仍满足筛选，
 * 不再满足的条目从该列表移除（与知识库同一策略）。
 */
function updateCachePatches(
  id: string,
  fields: Partial<ModelProvider>,
): CachePatch<UpdateVariables>[] {
  return [
    {
      queryKey: modelProviderKeys.item(id),
      exact: true,
      apply: (old) => {
        const model = old as ModelProvider | undefined;
        return model?.id === id ? { ...model, ...fields } : model;
      },
    },
    {
      queryKey: modelProviderKeys.listAll(),
      apply: (old, _vars, queryKey) =>
        patchOrRemoveCursorPageItem<ModelProvider>(
          id,
          (next) => matchesListFilter(listFilterOf(queryKey), next),
          fields,
        )(old),
    },
  ];
}

function deleteCachePatches(id: string): CachePatch<string>[] {
  return [
    {
      queryKey: modelProviderKeys.listAll(),
      apply: removeCursorPageItem<ModelProvider>(id),
    },
  ];
}

/**
 * 失败收尾：回滚快照 + 失效一次。
 *
 * 快照是整份列表数组，同缓存上并发写多个条目时，后失败那次的回滚会连带撤销先前
 * 成功的乐观写入，因此需要失效让缓存收敛到服务端真相（只在失败路径，避免成功路径
 * 重放已加载的分页）。
 */
async function rollbackAndRevalidate(
  queryClient: QueryClient,
  rollback: (() => void) | undefined,
  id: string,
) {
  rollback?.();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: modelProviderKeys.listAll() }),
    queryClient.invalidateQueries({
      queryKey: modelProviderKeys.item(id),
      exact: true,
    }),
  ]);
}

// ==== 查询 ================================================================

/**
 * 游标分页模型列表（无限滚动）。
 *
 * `staleTime: 3 分钟`：3 分钟内视为新鲜，重新进入页面直接复用缓存、不重放已加载分页。
 * gcTime 继承基础配置（5 分钟）：离开页面后缓存短期保留，回来仍可命中。
 */
export function useInfiniteModelProviderList(
  filter: ModelProviderListFilter = {},
  limit = MODEL_PROVIDER_PAGE_SIZE,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: modelProviderKeys.list({ ...filter, limit }),
    queryFn: ({ pageParam }) =>
      listModelProvidersApi({
        ...filter,
        limit,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 3 * 60 * 1000,
    enabled,
  });
}

/** 手动「刷新」：丢弃所有筛选的列表缓存并让当前筛选从第一页重新加载 */
export function useRefreshModelProviderList() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.resetQueries({ queryKey: modelProviderKeys.listAll() }),
    [queryClient],
  );
}

/**
 * 某一类型下的全部模型（只用于「默认模型设置」的下拉选项）。
 * 复用无限列表的查询与缓存形态，创建/修改/删除的失效同样能命中。
 */
export function useModelProvidersByType(
  type: ModelProviderType,
  enabled = true,
) {
  const query = useInfiniteModelProviderList({ type }, 100, enabled);
  // pages 引用稳定，flatMap 结果据此缓存：调用方按 models 记忆化菜单项才有意义
  const pages = query.data?.pages;
  const models = useMemo(
    () => pages?.flatMap((page) => page.list) ?? [],
    [pages],
  );
  return { models, isLoading: query.isLoading };
}

/**
 * 单个模型详情：只需要一条记录时按 id 取，避免为了显示一个名字拉整份列表。
 * 与列表共用 item key（增/改/删都会失效它）。
 */
export function useModelProvider(id: string | undefined) {
  return useQuery({
    queryKey: modelProviderKeys.item(id ?? ''),
    queryFn: () => getModelProviderApi(id as string),
    enabled: Boolean(id),
  });
}

/** 当前用户的默认模型设置（每种模型类型一条） */
export function useModelProviderDefaults(enabled = true) {
  return useQuery({
    queryKey: modelProviderKeys.defaults(),
    queryFn: getModelProviderDefaultsApi,
    enabled,
  });
}

/** 保存默认模型设置（整体替换），成功后直接写回缓存 */
export function useUpdateModelProviderDefaults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateModelProviderDefaultsApi,
    onSuccess: (data) => {
      queryClient.setQueryData(modelProviderKeys.defaults(), data);
    },
  });
}

/**
 * 聊天页用的 LLM 模型：复用无限列表（同一 queryKey 与 `{ pages }` 缓存形态），只取首页。
 */
export function useLlmModelProviders(limit = 100) {
  const query = useInfiniteModelProviderList({ type: 'llm' }, limit);
  const pages = query.data?.pages;
  // 同 useModelProvidersByType：保持 models 引用稳定，避免下游每次渲染重建菜单项
  const models = useMemo(
    () => pages?.flatMap((page) => page.list) ?? [],
    [pages],
  );
  return { models, isLoading: query.isLoading };
}

/** 创建模型，成功后执行与刷新按钮相同的重置（见 useRefreshModelProviderList）。 */
export function useCreateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModelProviderRequest) =>
      createModelProviderApi(input),
    onSuccess: async () => {
      await queryClient.resetQueries({
        queryKey: modelProviderKeys.listAll(),
      });
    },
  });
}

/**
 * 更新模型：乐观改写详情与列表，成功后用服务端值收敛。
 * 改名/改类型/改供应商后可能不再满足当前筛选，对应列表里的条目会立即移除。
 * 明文 apiKey 只随请求发送，不写入任何缓存。
 */
export function useUpdateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: UpdateVariables) =>
      updateModelProviderApi(variables.id, variables.input),
    onMutate: async (variables) => ({
      rollback: await applyOptimistic(
        queryClient,
        updateCachePatches(variables.id, updateFields(variables.input)),
        variables,
      ),
    }),
    onSuccess: (updated) =>
      patchModelInCache(queryClient, updated.id, {
        name: updated.name,
        type: updated.type,
        vendor: updated.vendor,
        baseUrl: updated.baseUrl,
        protocol: updated.protocol,
        contextLength: updated.contextLength,
        apiKeyMasked: updated.apiKeyMasked,
        updatedAt: updated.updatedAt,
      }),
    onError: (_error, variables, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, variables.id),
  });
}

/** 删除模型：先从列表移除（可回滚），成功后清掉详情缓存 */
export function useDeleteModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModelProviderApi(id),
    onMutate: async (id) => ({
      rollback: await applyOptimistic(queryClient, deleteCachePatches(id), id),
    }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: modelProviderKeys.item(id) });
    },
    onError: (_error, id, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, id),
  });
}

/** 测试连接（只读动作，无缓存副作用；结果由调用方展示） */
export function useTestModelProviderConnection() {
  return useMutation({
    mutationFn: (id: string) => testModelProviderConnectionApi(id),
  });
}
