import {
  addDocumentApi,
  createKnowledgeBaseApi,
  deleteDocumentApi,
  deleteKnowledgeBaseApi,
  getDocumentApi,
  getKnowledgeBaseApi,
  likeKnowledgeBaseApi,
  listDocumentsApi,
  listKnowledgeBasesApi,
  unlikeKnowledgeBaseApi,
  updateKnowledgeBaseApi,
} from '@/api/knowledge';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeBaseVisibility,
  KnowledgeDocument,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import type { CursorPageResult, KnowledgeListQuery } from '@lucy/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

/** 默认每页条数（游标分页，同时是列表 queryKey 的一部分） */
export const KNOWLEDGE_PAGE_SIZE = 20;

/** 知识库列表过滤条件（游标/每页条数由 hook 管理，不暴露给调用方） */
export type KnowledgeListFilter = {
  name?: string;
  visibility?: KnowledgeBaseVisibility;
};

/** 文档列表过滤条件 */
export type DocumentListFilter = {
  keyword?: string;
};

/** 知识库查询 key 工厂，统一管理 queryKey 生成逻辑 */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  /** 知识库维度 */
  bases: () => [...knowledgeKeys.all, 'bases'] as const,
  /** 列表失效前缀：只命中知识库列表查询（documents 段不在该前缀下，不会被误伤） */
  baseListAll: () => [...knowledgeKeys.bases(), 'list'] as const,
  /** 列表查询 key：携带过滤条件与每页条数（游标由 useInfiniteQuery 管理，不入 key） */
  baseList: (query: KnowledgeListQuery = {}) =>
    [...knowledgeKeys.baseListAll(), query] as const,
  base: (id: string) => [...knowledgeKeys.bases(), id] as const,
  /** 文档维度：嵌在某个知识库下，key 携带 kbId 自动隔离 */
  documents: (kbId: string) =>
    [...knowledgeKeys.bases(), kbId, 'documents'] as const,
  /** 某知识库文档列表的失效前缀（key 含 kbId，不误伤其它知识库） */
  documentListAll: (kbId: string) =>
    [...knowledgeKeys.documents(kbId), 'list'] as const,
  documentList: (kbId: string, query: DocumentListQueryShape = {}) =>
    [...knowledgeKeys.documentListAll(kbId), query] as const,
  document: (kbId: string, id: string) =>
    [...knowledgeKeys.documents(kbId), id] as const,
};

type DocumentListQueryShape = DocumentListFilter & { limit?: number };

// ==== 游标分页缓存操作 ====================================================
// 无限查询缓存形态：{ pages: CursorPageResult<T>[], pageParams: (string|null)[] }
// 只处理这一种形态（offset 形态已随游标分页一并移除），无需再兼容多形态。

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

/** 在无限查询缓存中按 id 查找条目 */
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

/** 统一更新知识库缓存：详情 + 所有列表分页（乐观更新，不触发 refetch） */
function patchBaseInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<KnowledgeBase>,
) {
  queryClient.setQueryData<KnowledgeBase>(knowledgeKeys.base(id), (old) =>
    old ? { ...old, ...patch } : old,
  );
  queryClient.setQueriesData({ queryKey: knowledgeKeys.baseListAll() }, (old) =>
    mapPages<KnowledgeBase>(old, (kb) =>
      kb.id === id ? { ...kb, ...patch } : kb,
    ),
  );
}

function findBaseInCache(
  queryClient: QueryClient,
  id: string,
): KnowledgeBase | undefined {
  const detail = queryClient.getQueryData<KnowledgeBase>(
    knowledgeKeys.base(id),
  );
  if (detail) return detail;
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: knowledgeKeys.baseListAll(),
  })) {
    const found = findInPages<KnowledgeBase>(data, id);
    if (found) return found;
  }
  return undefined;
}

function snapshotBaseLists(queryClient: QueryClient): Snapshot {
  return queryClient.getQueriesData<unknown>({
    queryKey: knowledgeKeys.baseListAll(),
  });
}

function restoreSnapshot(queryClient: QueryClient, snapshot: Snapshot) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

/** 判断新建的知识库是否属于当前过滤条件；不属于则不应插入列表 */
function matchesFilter(
  kb: KnowledgeBase,
  filter: KnowledgeListQuery | undefined,
): boolean {
  if (filter?.visibility && kb.visibility !== filter.visibility) return false;
  if (
    filter?.name &&
    !kb.name.toLowerCase().includes(filter.name.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** 把新建的知识库插入每个匹配过滤条件的列表首页顶部（乐观新增，不触发 refetch） */
function prependBaseToMatchingLists(
  queryClient: QueryClient,
  created: KnowledgeBase,
) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: knowledgeKeys.baseListAll(),
  });
  for (const query of queries) {
    const filter = query.queryKey[3] as KnowledgeListQuery | undefined;
    if (!matchesFilter(created, filter)) continue;
    queryClient.setQueryData(query.queryKey, (old: unknown) => {
      if (!old || typeof old !== 'object') return old;
      const data = old as InfinitePages<KnowledgeBase>;
      if (!Array.isArray(data.pages) || data.pages.length === 0) return old;
      const [first, ...rest] = data.pages;
      return {
        ...data,
        pages: [{ ...first, list: [created, ...first.list] }, ...rest],
      };
    });
  }
}

// ==== 知识库查询 ==========================================================

/**
 * 游标分页知识库列表（无限滚动）。
 * queryKey 携带过滤条件与每页条数；游标由 useInfiniteQuery 以 nextCursor 驱动，
 * 服务端游标是不可变定位点，翻页不会因数据变动产生重复/漏项。
 */
export function useInfiniteKnowledgeBaseList(
  filter: KnowledgeListFilter = {},
  limit = KNOWLEDGE_PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey: knowledgeKeys.baseList({ ...filter, limit }),
    queryFn: ({ pageParam }) =>
      listKnowledgeBasesApi({
        ...filter,
        limit,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
    // 保留默认 gcTime(5min)：离开 ≤5min 返回命中缓存，>5min 缓存回收后从首页重来。
    // 用 refetchOnMount/refetchOnReconnect 阻止重挂载与断网重连时重放历史分页
    // （useInfiniteQuery 重放会一次发 N 页请求）
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useKnowledgeBase(id: string | undefined) {
  return useQuery<KnowledgeBase>({
    queryKey: knowledgeKeys.base(id ?? ''),
    queryFn: () => getKnowledgeBaseApi(id!),
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKnowledgeBaseRequest) =>
      createKnowledgeBaseApi(input),
    onSuccess: (created) => prependBaseToMatchingLists(queryClient, created),
  });
}

/** 更新知识库（名称/描述/可见性）。乐观就地更新，onError 回滚。 */
export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      input: UpdateKnowledgeBaseRequest;
    }) => updateKnowledgeBaseApi(variables.id, variables.input),
    onMutate: async ({ id, input }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: knowledgeKeys.baseListAll() }),
        queryClient.cancelQueries({ queryKey: knowledgeKeys.base(id) }),
      ]);
      const previousBase = queryClient.getQueryData<KnowledgeBase>(
        knowledgeKeys.base(id),
      );
      const previousLists = snapshotBaseLists(queryClient);
      patchBaseInCache(queryClient, id, input);
      return { previousBase, previousLists };
    },
    onSuccess: (updated) => {
      // 只回填可更新字段：更新接口不返回 likeCount/isLiked，整体覆盖会丢点赞态
      const { name, description, visibility, updatedAt } = updated;
      patchBaseInCache(queryClient, updated.id, {
        name,
        description,
        visibility,
        updatedAt,
      });
    },
    onError: (_err, { id }, context) => {
      if (context?.previousBase) {
        queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
      }
      restoreSnapshot(queryClient, context?.previousLists ?? []);
    },
  });
}

/** 乐观从所有列表分页中移除指定知识库，并清掉详情与文档缓存 */
function removeBaseFromCache(queryClient: QueryClient, id: string) {
  // base(id) 前缀同时覆盖其下的 documents 缓存
  queryClient.removeQueries({ queryKey: knowledgeKeys.base(id) });
  queryClient.setQueriesData({ queryKey: knowledgeKeys.baseListAll() }, (old) =>
    filterOutBase(old, id),
  );
}

/** 从无限查询缓存的每页 list 中剔除指定知识库 */
function filterOutBase(old: unknown, id: string): unknown {
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
        list: (p.list as KnowledgeBase[]).filter((kb) => kb.id !== id),
      };
    }),
  };
}

/** 删除知识库。乐观移除，onError 回滚。 */
export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: knowledgeKeys.baseListAll(),
      });
      const previousLists = snapshotBaseLists(queryClient);
      const previousBase = queryClient.getQueryData<KnowledgeBase>(
        knowledgeKeys.base(id),
      );
      const previousDocuments = queryClient.getQueriesData<unknown>({
        queryKey: knowledgeKeys.documents(id),
      });
      removeBaseFromCache(queryClient, id);
      return { previousLists, previousBase, previousDocuments };
    },
    onError: (_err, id, context) => {
      restoreSnapshot(queryClient, context?.previousLists ?? []);
      if (context?.previousBase) {
        queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
      }
      restoreSnapshot(queryClient, context?.previousDocuments ?? []);
    },
  });
}

/** 乐观更新点赞态（同时更新详情与所有列表分页） */
function patchLikeInCache(
  queryClient: QueryClient,
  id: string,
  result: { likeCount: number; isLiked: boolean },
) {
  patchBaseInCache(queryClient, id, result);
}

/** 点赞/取消点赞共享的乐观前置逻辑 */
async function optimisticLike(
  queryClient: QueryClient,
  id: string,
  next: { isLiked: boolean; delta: number },
) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: knowledgeKeys.baseListAll() }),
    queryClient.cancelQueries({ queryKey: knowledgeKeys.base(id) }),
  ]);
  const previousBase = queryClient.getQueryData<KnowledgeBase>(
    knowledgeKeys.base(id),
  );
  const previousLists = snapshotBaseLists(queryClient);
  const current = findBaseInCache(queryClient, id);
  const likeCount = Math.max(0, (current?.likeCount ?? 0) + next.delta);
  patchLikeInCache(queryClient, id, { isLiked: next.isLiked, likeCount });
  return { previousBase, previousLists };
}

function rollbackLike(
  queryClient: QueryClient,
  id: string,
  context:
    { previousBase?: KnowledgeBase; previousLists: Snapshot } | undefined,
) {
  if (context?.previousBase) {
    queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
  }
  restoreSnapshot(queryClient, context?.previousLists ?? []);
}

/** 点赞知识库。乐观更新 UI，onSuccess 用服务端返回的真实值覆盖缓存。 */
export function useLikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => likeKnowledgeBaseApi(id),
    onMutate: (id) =>
      optimisticLike(queryClient, id, { isLiked: true, delta: 1 }),
    onSuccess: (result, id) => patchLikeInCache(queryClient, id, result),
    onError: (_err, id, context) => rollbackLike(queryClient, id, context),
  });
}

/** 取消点赞知识库。乐观更新 UI，onSuccess 用服务端返回的真实值覆盖缓存。 */
export function useUnlikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlikeKnowledgeBaseApi(id),
    onMutate: (id) =>
      optimisticLike(queryClient, id, { isLiked: false, delta: -1 }),
    onSuccess: (result, id) => patchLikeInCache(queryClient, id, result),
    onError: (_err, id, context) => rollbackLike(queryClient, id, context),
  });
}

// ==== 文档查询 ============================================================

/** 游标分页文档列表（无限滚动） */
export function useInfiniteDocumentList(
  kbId: string | undefined,
  filter: DocumentListFilter = {},
  limit = KNOWLEDGE_PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey: knowledgeKeys.documentList(kbId ?? '', { ...filter, limit }),
    queryFn: ({ pageParam }) =>
      listDocumentsApi(kbId!, {
        ...filter,
        limit,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!kbId,
    staleTime: 0,
    // 同知识库列表：保留缓存但不在重挂载/重连时重放分页
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
}

export function useDocument(kbId: string | undefined, id: string | undefined) {
  return useQuery<KnowledgeDocument>({
    queryKey: knowledgeKeys.document(kbId ?? '', id ?? ''),
    queryFn: () => getDocumentApi(kbId!, id!),
    enabled: !!kbId && !!id,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useAddDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, file }: { kbId: string; file: File }) =>
      addDocumentApi(kbId, file),
    onSuccess: async (_doc, { kbId }) => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentListAll(kbId),
      });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kbId, id }: { kbId: string; id: string }) =>
      deleteDocumentApi(kbId, id),
    onSuccess: async (_data, { kbId, id }) => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentListAll(kbId),
      });
      queryClient.removeQueries({
        queryKey: knowledgeKeys.document(kbId, id),
      });
    },
  });
}
