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
  KnowledgeDocument,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import type {
  DocumentListQuery,
  KnowledgeListQuery,
  PageResult,
} from '@lucy/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

/** 知识库查询 key 工厂，统一管理 queryKey 生成逻辑 */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  /** 知识库维度 */
  bases: () => [...knowledgeKeys.all, 'bases'] as const,
  /** 列表失效前缀：只命中知识库列表查询（documents 段不在该前缀下，不会被误伤） */
  baseListAll: () => [...knowledgeKeys.bases(), 'list'] as const,
  /** 列表查询（含分页参数） */
  baseList: (query: KnowledgeListQuery = {}) =>
    [...knowledgeKeys.baseListAll(), query] as const,
  /** 无限滚动列表查询（page 由 useInfiniteQuery 控制，不入 key） */
  baseListInfinite: (query: KnowledgeListQuery = {}) =>
    [...knowledgeKeys.baseListAll(), 'infinite', query] as const,
  base: (id: string) => [...knowledgeKeys.bases(), id] as const,
  /** 文档维度：嵌在某个知识库下，key 携带 kbId 自动隔离 */
  documents: (kbId: string) =>
    [...knowledgeKeys.bases(), kbId, 'documents'] as const,
  documentList: (kbId: string, query: DocumentListQuery = {}) =>
    [...knowledgeKeys.documents(kbId), 'list', query] as const,
  /** 无限滚动文档列表查询（page 由 useInfiniteQuery 控制，不入 key） */
  documentListInfinite: (kbId: string, query: DocumentListQuery = {}) =>
    [...knowledgeKeys.documents(kbId), 'list', 'infinite', query] as const,
  document: (kbId: string, id: string) =>
    [...knowledgeKeys.documents(kbId), id] as const,
};

// 列表失效前缀：命中该知识库下所有分页的文档查询，
// 但不会误伤其它知识库的文档（key 含 kbId）。
export const documentListAll = (kbId: string) =>
  [...knowledgeKeys.documents(kbId), 'list'] as const;

export function useKnowledgeBaseList(query: KnowledgeListQuery = {}) {
  return useQuery<PageResult<KnowledgeBase>>({
    queryKey: knowledgeKeys.baseList(query),
    queryFn: () => listKnowledgeBasesApi(query),
    placeholderData: (prev) => prev,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * 无限滚动知识库列表查询。
 * queryKey 包含 pageSize，确保不同 pageSize 使用独立缓存。
 */
export function useInfiniteKnowledgeBaseList(
  query: Omit<KnowledgeListQuery, 'page' | 'pageSize'> = {},
  pageSize = 20,
) {
  return useInfiniteQuery<PageResult<KnowledgeBase>>({
    queryKey: [
      ...knowledgeKeys.baseListInfinite(query as KnowledgeListQuery),
      pageSize,
    ],
    queryFn: ({ pageParam = 1 }) =>
      listKnowledgeBasesApi({ ...query, page: pageParam as number, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    staleTime: 0,
    gcTime: 0,
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.baseListAll(),
      });
    },
  });
}

export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      input: UpdateKnowledgeBaseRequest;
    }) => updateKnowledgeBaseApi(variables.id, variables.input),
    onSuccess: async (_updated, { id }) => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.baseListAll(),
      });
      await queryClient.invalidateQueries({ queryKey: knowledgeKeys.base(id) });
    },
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseApi(id),
    onSuccess: async (_data, id) => {
      // 仅失效知识库列表缓存；该知识库单条/其下文档的缓存一并移除（base(id) 是 documents(id) 的前缀，命中即一并清掉）
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.baseListAll(),
      });
      queryClient.removeQueries({ queryKey: knowledgeKeys.base(id) });
    },
  });
}

/**
 * 更新缓存中指定知识库的 like 状态。
 * 同时处理：
 * - knowledgeKeys.base(id) 单条缓存（KnowledgeBase 形态）
 * - knowledgeKeys.baseListAll() 前缀下的列表/无限滚动缓存（PageResult / 无限滚动 pages 形态）
 */
function updateLikeInCache(
  queryClient: QueryClient,
  id: string,
  result: { likeCount: number; isLiked: boolean },
) {
  // 单条缓存
  queryClient.setQueryData<KnowledgeBase>(knowledgeKeys.base(id), (old) =>
    old ? { ...old, ...result } : old,
  );
  // 列表/无限滚动缓存（前缀匹配）
  queryClient.setQueriesData({ queryKey: knowledgeKeys.baseListAll() }, (old) =>
    updateListLike(old, id, result),
  );
}

/** 递归处理可能的列表数据形态 */
function updateListLike(
  old: unknown,
  id: string,
  result: { likeCount: number; isLiked: boolean },
): unknown {
  if (!old || typeof old !== 'object') return old;
  const obj = old as Record<string, unknown>;
  // 形态 1：{ list: KnowledgeBase[], total, page, pageSize }
  if (Array.isArray(obj.list)) {
    return {
      ...obj,
      list: (obj.list as KnowledgeBase[]).map((kb) =>
        kb.id === id ? { ...kb, ...result } : kb,
      ),
    };
  }
  // 形态 2：无限滚动 { pages: PageResult[], pageParams: number[] }
  if (Array.isArray(obj.pages)) {
    return {
      ...obj,
      pages: (obj.pages as Array<Record<string, unknown>>).map((page) =>
        updateListLike(page, id, result),
      ),
    };
  }
  return old;
}

/** 快照 baseListAll 前缀下所有查询，用于 onError 回滚 */
function snapshotLists(queryClient: QueryClient) {
  return queryClient.getQueriesData<unknown>({
    queryKey: knowledgeKeys.baseListAll(),
  });
}

function restoreLists(
  queryClient: QueryClient,
  snapshot: ReadonlyArray<[readonly unknown[], unknown]>,
) {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

/**
 * 点赞知识库。
 * 乐观更新 UI，onSuccess 用服务端返回的真实 likeCount/isLiked 覆盖缓存。
 */
export function useLikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => likeKnowledgeBaseApi(id),
    onMutate: async (id) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: knowledgeKeys.baseListAll() }),
        queryClient.cancelQueries({ queryKey: knowledgeKeys.base(id) }),
      ]);
      const previousBase = queryClient.getQueryData<KnowledgeBase>(
        knowledgeKeys.base(id),
      );
      const previousLists = snapshotLists(queryClient);
      updateLikeInCache(queryClient, id, {
        isLiked: true,
        likeCount: (previousBase?.likeCount ?? 0) + 1,
      });
      return { previousBase, previousLists };
    },
    onSuccess: (result, id) => {
      updateLikeInCache(queryClient, id, result);
    },
    onError: (_err, id, context) => {
      if (context?.previousBase) {
        queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
      }
      restoreLists(queryClient, context?.previousLists ?? []);
    },
  });
}

/**
 * 取消点赞知识库。
 * 乐观更新 UI，onSuccess 用服务端返回的真实 likeCount/isLiked 覆盖缓存。
 */
export function useUnlikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlikeKnowledgeBaseApi(id),
    onMutate: async (id) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: knowledgeKeys.baseListAll() }),
        queryClient.cancelQueries({ queryKey: knowledgeKeys.base(id) }),
      ]);
      const previousBase = queryClient.getQueryData<KnowledgeBase>(
        knowledgeKeys.base(id),
      );
      const previousLists = snapshotLists(queryClient);
      updateLikeInCache(queryClient, id, {
        isLiked: false,
        likeCount: Math.max((previousBase?.likeCount ?? 0) - 1, 0),
      });
      return { previousBase, previousLists };
    },
    onSuccess: (result, id) => {
      updateLikeInCache(queryClient, id, result);
    },
    onError: (_err, id, context) => {
      if (context?.previousBase) {
        queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
      }
      restoreLists(queryClient, context?.previousLists ?? []);
    },
  });
}

export function useDocumentList(
  kbId: string | undefined,
  query: DocumentListQuery = {},
) {
  return useQuery<PageResult<KnowledgeDocument>>({
    queryKey: knowledgeKeys.documentList(kbId ?? '', query),
    queryFn: () => listDocumentsApi(kbId!, query),
    enabled: !!kbId,
    placeholderData: (prev) => prev,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * 无限滚动文档列表查询。
 * queryKey 包含 pageSize，确保不同 pageSize 使用独立缓存。
 */
export function useInfiniteDocumentList(
  kbId: string | undefined,
  query: Omit<DocumentListQuery, 'page' | 'pageSize'> = {},
  pageSize = 20,
) {
  return useInfiniteQuery<PageResult<KnowledgeDocument>>({
    queryKey: [
      ...knowledgeKeys.documentListInfinite(
        kbId ?? '',
        query as DocumentListQuery,
      ),
      pageSize,
    ],
    queryFn: ({ pageParam = 1 }) =>
      listDocumentsApi(kbId!, {
        ...query,
        page: pageParam as number,
        pageSize,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.pageSize;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled: !!kbId,
    staleTime: 0,
    gcTime: 0,
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
        queryKey: documentListAll(kbId),
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
        queryKey: documentListAll(kbId),
      });
      queryClient.removeQueries({
        queryKey: knowledgeKeys.document(kbId, id),
      });
    },
  });
}
