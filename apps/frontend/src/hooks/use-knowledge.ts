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
  KnowledgeDocumentListItem,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import type { KnowledgeListQuery } from '@lucy/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ListCacheKeys,
  type ListsSnapshot,
  filterOutItem,
  findItemInCache,
  patchItemInCache,
  prependToMatchingLists,
  rollbackToSnapshot,
  snapshotLists,
  useCursorList,
  useResetListCache,
} from './lib/infinite-cache';

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

/** 知识库的列表前缀 + 详情 key：缓存操作只需这两个 */
const baseCacheKeys = (id: string): ListCacheKeys => ({
  listAll: knowledgeKeys.baseListAll(),
  item: knowledgeKeys.base(id),
});

/** 判断新建的知识库是否属于当前过滤条件；不属于则不应插入列表 */
function matchesFilter(kb: KnowledgeBase, filter: unknown): boolean {
  const current = filter as KnowledgeListQuery | undefined;
  if (current?.visibility && kb.visibility !== current.visibility) return false;
  if (
    current?.name &&
    !kb.name.toLowerCase().includes(current.name.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** 统一更新知识库缓存：详情 + 所有列表分页（乐观更新，不触发 refetch） */
function patchBaseInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<KnowledgeBase>,
) {
  patchItemInCache<KnowledgeBase>(queryClient, baseCacheKeys(id), id, patch);
}

/** 乐观从所有列表分页中移除指定知识库，并清掉详情与文档缓存 */
function removeBaseFromCache(queryClient: QueryClient, id: string) {
  // base(id) 前缀同时覆盖其下的 documents 缓存
  queryClient.removeQueries({ queryKey: knowledgeKeys.base(id) });
  queryClient.setQueriesData({ queryKey: knowledgeKeys.baseListAll() }, (old) =>
    filterOutItem<KnowledgeBase>(old, id),
  );
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
  return useCursorList<KnowledgeBase>({
    queryKey: knowledgeKeys.baseList({ ...filter, limit }),
    fetchPage: (cursor) => listKnowledgeBasesApi({ ...filter, limit, cursor }),
  });
}

/** 手动「刷新」：丢弃所有筛选的列表缓存并让当前筛选从第一页重新加载 */
export function useRefreshKnowledgeBaseList() {
  return useResetListCache(knowledgeKeys.baseListAll);
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
    onSuccess: (created) =>
      prependToMatchingLists<KnowledgeBase>(
        queryClient,
        knowledgeKeys.baseListAll(),
        created,
        matchesFilter,
      ),
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
      const previousLists = snapshotLists(
        queryClient,
        knowledgeKeys.baseListAll(),
      );
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
      rollbackToSnapshot(queryClient, context?.previousLists);
    },
  });
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
      const previousLists = snapshotLists(
        queryClient,
        knowledgeKeys.baseListAll(),
      );
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
      rollbackToSnapshot(queryClient, context?.previousLists);
      if (context?.previousBase) {
        queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
      }
      rollbackToSnapshot(queryClient, context?.previousDocuments);
    },
  });
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
  const previousLists = snapshotLists(queryClient, knowledgeKeys.baseListAll());
  const current = findItemInCache<KnowledgeBase>(
    queryClient,
    baseCacheKeys(id),
    id,
  );
  const likeCount = Math.max(0, (current?.likeCount ?? 0) + next.delta);
  patchBaseInCache(queryClient, id, { isLiked: next.isLiked, likeCount });
  return { previousBase, previousLists };
}

function rollbackLike(
  queryClient: QueryClient,
  id: string,
  context:
    { previousBase?: KnowledgeBase; previousLists: ListsSnapshot } | undefined,
) {
  if (context?.previousBase) {
    queryClient.setQueryData(knowledgeKeys.base(id), context.previousBase);
  }
  rollbackToSnapshot(queryClient, context?.previousLists);
}

/** 点赞知识库。乐观更新 UI，onSuccess 用服务端返回的真实值覆盖缓存。 */
export function useLikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => likeKnowledgeBaseApi(id),
    onMutate: (id) =>
      optimisticLike(queryClient, id, { isLiked: true, delta: 1 }),
    onSuccess: (result, id) => patchBaseInCache(queryClient, id, result),
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
    onSuccess: (result, id) => patchBaseInCache(queryClient, id, result),
    onError: (_err, id, context) => rollbackLike(queryClient, id, context),
  });
}

// ==== 文档查询 ============================================================

/**
 * 游标分页文档列表（无限滚动）。
 * 与知识库列表同策略（保留缓存、不在重挂载/重连时重放分页），但不做换筛选占位：
 * 文档列表嵌在某个知识库下，kbId 变更时整块内容本就该重取。
 */
export function useInfiniteDocumentList(
  kbId: string | undefined,
  filter: DocumentListFilter = {},
  limit = KNOWLEDGE_PAGE_SIZE,
) {
  return useCursorList<KnowledgeDocumentListItem>({
    queryKey: knowledgeKeys.documentList(kbId ?? '', { ...filter, limit }),
    fetchPage: (cursor) =>
      listDocumentsApi(kbId!, { ...filter, limit, cursor }),
    enabled: !!kbId,
    staleTime: 0,
    keepPreviousData: false,
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
