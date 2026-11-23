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
  ModelProviderType,
  ModelProviderVendor,
  UpdateModelProviderRequest,
} from '@/api/types';
import type { ModelProviderListQuery } from '@lucy/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

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

// ==== 查询 ================================================================

/**
 * 游标分页模型列表（无限滚动）。
 * 缓存已整体关闭：每次挂载从首页重新请求，不复用历史分页。
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
    refetchOnWindowFocus: false,
    enabled,
  });
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

/** 创建模型，成功后失效列表（重新拉取首页）。 */
export function useCreateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModelProviderRequest) =>
      createModelProviderApi(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: modelProviderKeys.listAll(),
      });
    },
  });
}

/** 更新模型，成功后失效详情与列表（不把明文 apiKey 写入任何缓存）。 */
export function useUpdateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      input: UpdateModelProviderRequest;
    }) => updateModelProviderApi(variables.id, variables.input),
    onSuccess: async (_data, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: modelProviderKeys.item(id),
        }),
        queryClient.invalidateQueries({
          queryKey: modelProviderKeys.listAll(),
        }),
      ]);
    },
  });
}

/** 删除模型，成功后清掉详情缓存并失效列表。 */
export function useDeleteModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModelProviderApi(id),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: modelProviderKeys.item(id) });
      await queryClient.invalidateQueries({
        queryKey: modelProviderKeys.listAll(),
      });
    },
  });
}

/** 测试连接（只读动作，无缓存副作用；结果由调用方展示） */
export function useTestModelProviderConnection() {
  return useMutation({
    mutationFn: (id: string) => testModelProviderConnectionApi(id),
  });
}
