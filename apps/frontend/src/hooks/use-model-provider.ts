import {
  createModelProviderApi,
  deleteModelProviderApi,
  listModelProvidersApi,
  testModelProviderConnectionApi,
  updateModelProviderApi,
} from '@/api/model-provider';
import type {
  CreateModelProviderRequest,
  ModelProvider,
  ModelProviderType,
  UpdateModelProviderRequest,
} from '@/api/types';
import type { ModelProviderListQuery } from '@lucy/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ListCacheKeys,
  filterOutItem,
  findItemInCache,
  patchItemInCache,
  prependToMatchingLists,
  rollbackToSnapshot,
  snapshotLists,
  useCursorList,
} from './lib/infinite-cache';

/** 默认每页条数（游标分页，同时是列表 queryKey 的一部分） */
export const MODEL_PROVIDER_PAGE_SIZE = 20;

/** 模型列表过滤条件（游标/每页条数由 hook 管理，不暴露给调用方） */
export type ModelProviderListFilter = {
  name?: string;
  type?: ModelProviderType;
};

/** 查询 key 工厂，统一管理 queryKey 生成逻辑 */
export const modelProviderKeys = {
  all: ['model-provider'] as const,
  /** 列表失效前缀：只命中列表查询 */
  listAll: () => [...modelProviderKeys.all, 'list'] as const,
  list: (query: ModelProviderListQuery = {}) =>
    [...modelProviderKeys.listAll(), query] as const,
  item: (id: string) => [...modelProviderKeys.all, id] as const,
};

/** 模型的列表前缀 + 详情 key：缓存操作只需这两个 */
const modelCacheKeys = (id: string): ListCacheKeys => ({
  listAll: modelProviderKeys.listAll(),
  item: modelProviderKeys.item(id),
});

/** 判断新建的模型是否属于当前过滤条件；不属于则不应插入列表 */
function matchesFilter(item: ModelProvider, filter: unknown): boolean {
  const current = filter as ModelProviderListQuery | undefined;
  if (current?.type && item.type !== current.type) return false;
  if (
    current?.name &&
    !item.name.toLowerCase().includes(current.name.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** 统一更新模型缓存：详情 + 所有列表分页（乐观更新，不触发 refetch） */
function patchModelInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<ModelProvider>,
) {
  patchItemInCache<ModelProvider>(queryClient, modelCacheKeys(id), id, patch);
}

// ==== 查询 ================================================================

/**
 * 游标分页模型列表（无限滚动）。
 * 与知识库列表同策略：换筛选用上一组数据占位保持可见，返回时零请求复用缓存。
 */
export function useInfiniteModelProviderList(
  filter: ModelProviderListFilter = {},
  limit = MODEL_PROVIDER_PAGE_SIZE,
) {
  return useCursorList<ModelProvider>({
    queryKey: modelProviderKeys.list({ ...filter, limit }),
    fetchPage: (cursor) => listModelProvidersApi({ ...filter, limit, cursor }),
  });
}

/**
 * 聊天页用的 LLM 模型：复用无限列表（同一 queryKey 与 `{ pages }` 缓存形态，
 * 增/改/删的乐观更新才能命中；普通 useQuery 的 `{ list }` 形态会被更新器静默忽略），只取首页。
 */
export function useLlmModelProviders(limit = 100) {
  const query = useInfiniteModelProviderList({ type: 'llm' }, limit);
  const models = query.data?.pages.flatMap((page) => page.list) ?? [];
  return { models, isLoading: query.isLoading };
}

export function useCreateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModelProviderRequest) =>
      createModelProviderApi(input),
    onSuccess: (created) =>
      prependToMatchingLists<ModelProvider>(
        queryClient,
        modelProviderKeys.listAll(),
        created,
        matchesFilter,
      ),
  });
}

/** 更新模型。乐观就地更新，onError 回滚。
 * `input` 可能含明文 apiKey——**绝不**写入缓存：只回填展示安全字段。 */
export function useUpdateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      input: UpdateModelProviderRequest;
    }) => updateModelProviderApi(variables.id, variables.input),
    onMutate: async ({ id, input }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: modelProviderKeys.listAll() }),
        queryClient.cancelQueries({ queryKey: modelProviderKeys.item(id) }),
      ]);
      const previousItem = queryClient.getQueryData<ModelProvider>(
        modelProviderKeys.item(id),
      );
      const previousLists = snapshotLists(
        queryClient,
        modelProviderKeys.listAll(),
      );
      // 显式挑出展示安全字段，避免把 input.apiKey 明文带进缓存
      const { name, type, vendor, baseUrl, protocol, contextLength } = input;
      const safe: Partial<ModelProvider> = {};
      if (name !== undefined) safe.name = name;
      if (type !== undefined) safe.type = type;
      if (vendor !== undefined) safe.vendor = vendor;
      if (baseUrl !== undefined) safe.baseUrl = baseUrl;
      if (protocol !== undefined) safe.protocol = protocol;
      if (contextLength !== undefined) safe.contextLength = contextLength;
      patchModelInCache(queryClient, id, safe);
      return { previousItem, previousLists };
    },
    onSuccess: (updated) => {
      const {
        name,
        type,
        vendor,
        baseUrl,
        protocol,
        contextLength,
        apiKeyMasked,
        updatedAt,
      } = updated;
      patchModelInCache(queryClient, updated.id, {
        name,
        type,
        vendor,
        baseUrl,
        protocol,
        contextLength,
        apiKeyMasked,
        updatedAt,
      });
    },
    onError: (_err, { id }, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(
          modelProviderKeys.item(id),
          context.previousItem,
        );
      }
      rollbackToSnapshot(queryClient, context?.previousLists);
    },
  });
}

/** 删除模型。乐观移除，onError 回滚。 */
export function useDeleteModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteModelProviderApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: modelProviderKeys.listAll(),
      });
      const previousLists = snapshotLists(
        queryClient,
        modelProviderKeys.listAll(),
      );
      const previousItem = findItemInCache<ModelProvider>(
        queryClient,
        modelCacheKeys(id),
        id,
      );
      queryClient.removeQueries({ queryKey: modelProviderKeys.item(id) });
      queryClient.setQueriesData(
        { queryKey: modelProviderKeys.listAll() },
        (old) => filterOutItem<ModelProvider>(old, id),
      );
      return { previousLists, previousItem };
    },
    onError: (_err, id, context) => {
      rollbackToSnapshot(queryClient, context?.previousLists);
      if (context?.previousItem) {
        queryClient.setQueryData(
          modelProviderKeys.item(id),
          context.previousItem,
        );
      }
    },
  });
}

/** 测试连接（只读动作，无缓存副作用；结果由调用方展示） */
export function useTestModelProviderConnection() {
  return useMutation({
    mutationFn: (id: string) => testModelProviderConnectionApi(id),
  });
}
