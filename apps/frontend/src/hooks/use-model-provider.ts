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
import type { CursorPageResult, ModelProviderListQuery } from '@lucy/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

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

// ==== 游标分页缓存操作 ====================================================
// 无限查询缓存形态：{ pages: CursorPageResult<T>[], pageParams: (string|null)[] }

type InfinitePages<T> = {
  pages: CursorPageResult<T>[];
  pageParams: unknown[];
};

type Snapshot = ReadonlyArray<[readonly unknown[], unknown]>;

/** 对无限查询缓存中每一页的 list 做映射；非无限形态原样返回 */
function mapPages<T extends { id: string }>(
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

function findInPages<T extends { id: string }>(
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

/** 统一更新模型缓存：详情 + 所有列表分页（乐观更新，不触发 refetch） */
function patchItemInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<ModelProvider>,
) {
  queryClient.setQueryData<ModelProvider>(modelProviderKeys.item(id), (old) =>
    old ? { ...old, ...patch } : old,
  );
  queryClient.setQueriesData({ queryKey: modelProviderKeys.listAll() }, (old) =>
    mapPages<ModelProvider>(old, (m) => (m.id === id ? { ...m, ...patch } : m)),
  );
}

function findItemInCache(
  queryClient: QueryClient,
  id: string,
): ModelProvider | undefined {
  const detail = queryClient.getQueryData<ModelProvider>(
    modelProviderKeys.item(id),
  );
  if (detail) return detail;
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: modelProviderKeys.listAll(),
  })) {
    const found = findInPages<ModelProvider>(data, id);
    if (found) return found;
  }
  return undefined;
}

function snapshotLists(queryClient: QueryClient): Snapshot {
  return queryClient.getQueriesData<unknown>({
    queryKey: modelProviderKeys.listAll(),
  });
}

function restoreSnapshot(queryClient: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

/** 判断新建的模型是否属于当前过滤条件；不属于则不应插入列表 */
function matchesFilter(
  item: ModelProvider,
  filter: ModelProviderListQuery | undefined,
): boolean {
  if (filter?.type && item.type !== filter.type) return false;
  if (
    filter?.name &&
    !item.name.toLowerCase().includes(filter.name.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** 把新建的模型插入每个匹配过滤条件的列表首页顶部（乐观新增，不触发 refetch） */
function prependToMatchingLists(
  queryClient: QueryClient,
  created: ModelProvider,
) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: modelProviderKeys.listAll(),
  });
  for (const query of queries) {
    // 列表 key 的最末元素即过滤条件（不写死下标，避免 key 结构变化后静默取错）
    const filter = query.queryKey.at(-1) as ModelProviderListQuery | undefined;
    if (!matchesFilter(created, filter)) continue;
    queryClient.setQueryData(query.queryKey, (old: unknown) => {
      if (!old || typeof old !== 'object') return old;
      const data = old as InfinitePages<ModelProvider>;
      if (!Array.isArray(data.pages) || data.pages.length === 0) return old;
      const [first, ...rest] = data.pages;
      return {
        ...data,
        pages: [{ ...first, list: [created, ...first.list] }, ...rest],
      };
    });
  }
}

/** 从无限查询缓存的每页 list 中剔除指定模型 */
function filterOut(old: unknown, id: string): unknown {
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
        list: (p.list as ModelProvider[]).filter((m) => m.id !== id),
      };
    }),
  };
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
    staleTime: 0,
    placeholderData: (prev) => prev,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

/** 聊天页用的 LLM 模型：只取首页（上限 100），与无限列表共用前缀便于统一失效 */
export function useLlmModelProviders() {
  return useQuery({
    queryKey: modelProviderKeys.list({ type: 'llm', limit: 100 }),
    queryFn: () => listModelProvidersApi({ type: 'llm', limit: 100 }),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useCreateModelProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateModelProviderRequest) =>
      createModelProviderApi(input),
    onSuccess: (created) => prependToMatchingLists(queryClient, created),
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
      const previousLists = snapshotLists(queryClient);
      // 显式挑出展示安全字段，避免把 input.apiKey 明文带进缓存
      const { name, type, vendor, baseUrl, protocol, contextLength } = input;
      const safe: Partial<ModelProvider> = {};
      if (name !== undefined) safe.name = name;
      if (type !== undefined) safe.type = type;
      if (vendor !== undefined) safe.vendor = vendor;
      if (baseUrl !== undefined) safe.baseUrl = baseUrl;
      if (protocol !== undefined) safe.protocol = protocol;
      if (contextLength !== undefined) safe.contextLength = contextLength;
      patchItemInCache(queryClient, id, safe);
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
      patchItemInCache(queryClient, updated.id, {
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
      restoreSnapshot(queryClient, context?.previousLists ?? []);
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
      const previousLists = snapshotLists(queryClient);
      const previousItem = findItemInCache(queryClient, id);
      queryClient.removeQueries({ queryKey: modelProviderKeys.item(id) });
      queryClient.setQueriesData(
        { queryKey: modelProviderKeys.listAll() },
        (old) => filterOut(old, id),
      );
      return { previousLists, previousItem };
    },
    onError: (_err, id, context) => {
      restoreSnapshot(queryClient, context?.previousLists ?? []);
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
