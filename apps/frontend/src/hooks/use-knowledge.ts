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
  updateKnowledgeVisibilityApi,
} from '@/api/knowledge';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeBaseVisibility,
  KnowledgeDocument,
  KnowledgeDocumentListItem,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import type {
  DocumentListQuery,
  KnowledgeListQuery,
  PageResult,
} from '@lucy/shared';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { type CachePatch, applyOptimistic } from './lib/optimistic';
import { patchCursorPageItem, removeCursorPageItem } from './lib/query-shapes';

/** 默认每页条数（游标分页，同时是列表 queryKey 的一部分） */
export const KNOWLEDGE_PAGE_SIZE = 20;

/** 知识库列表过滤条件（游标/每页条数由 hook 管理，不暴露给调用方） */
export type KnowledgeListFilter = {
  name?: string;
  visibility?: KnowledgeBaseVisibility;
};

/** 文档列表过滤条件（页码与每页条数由调用方给，这里只表达业务筛选） */
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
  /** 文档列表查询 key：携带页码/每页条数与关键字（与后端 PageQueryDto 参数同形） */
  documentList: (kbId: string, query: DocumentListQuery = {}) =>
    [...knowledgeKeys.documentListAll(kbId), query] as const,
  document: (kbId: string, id: string) =>
    [...knowledgeKeys.documents(kbId), id] as const,
};

// ==== 乐观更新 ============================================================

type VisibilityVariables = {
  id: string;
  visibility: KnowledgeBaseVisibility;
};

/** 写回缓存：详情（精确 key）+ 所有筛选条件的列表分页（前缀），不触发 refetch */
function patchBaseInCache(
  queryClient: QueryClient,
  id: string,
  patch: Partial<KnowledgeBase>,
) {
  queryClient.setQueryData<KnowledgeBase>(knowledgeKeys.base(id), (old) =>
    old?.id === id ? { ...old, ...patch } : old,
  );
  queryClient.setQueriesData(
    { queryKey: knowledgeKeys.baseListAll() },
    patchCursorPageItem<KnowledgeBase>(id, patch),
  );
}

/** 点赞/取消点赞：详情与列表里的同一条目同步改，计数做下限保护 */
function likeCachePatches(id: string, isLiked: boolean): CachePatch<string>[] {
  const delta = isLiked ? 1 : -1;
  const nextFields = (item: KnowledgeBase) => ({
    isLiked,
    likeCount: Math.max(0, item.likeCount + delta),
  });
  return [
    {
      queryKey: knowledgeKeys.base(id),
      exact: true,
      apply: (old) => {
        const base = old as KnowledgeBase | undefined;
        return base?.id === id ? { ...base, ...nextFields(base) } : base;
      },
    },
    {
      queryKey: knowledgeKeys.baseListAll(),
      apply: patchCursorPageItem<KnowledgeBase>(id, nextFields),
    },
  ];
}

/** 可见性切换：列表 key 末位是筛选条件，新值不再满足筛选时把条目移出该列表 */
function visibilityCachePatches(
  id: string,
  visibility: KnowledgeBaseVisibility,
): CachePatch<VisibilityVariables>[] {
  return [
    {
      queryKey: knowledgeKeys.base(id),
      exact: true,
      apply: (old) => {
        const base = old as KnowledgeBase | undefined;
        return base?.id === id ? { ...base, visibility } : base;
      },
    },
    {
      queryKey: knowledgeKeys.baseListAll(),
      apply: (old, _vars, queryKey) => {
        // key 约定为 [...baseListAll(), 查询参数]（见 knowledgeKeys.baseList）
        const filter = queryKey.at(-1) as KnowledgeListQuery | undefined;
        const stays = !filter?.visibility || filter.visibility === visibility;
        return stays
          ? patchCursorPageItem<KnowledgeBase>(id, { visibility })(old)
          : removeCursorPageItem<KnowledgeBase>(id)(old);
      },
    },
  ];
}

function deleteCachePatches(id: string): CachePatch<string>[] {
  return [
    {
      queryKey: knowledgeKeys.baseListAll(),
      apply: removeCursorPageItem<KnowledgeBase>(id),
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
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.baseListAll() }),
    queryClient.invalidateQueries({
      queryKey: knowledgeKeys.base(id),
      exact: true,
    }),
  ]);
}

// ==== 知识库查询 ==========================================================

/**
 * 游标分页知识库列表（无限滚动）。
 * 缓存已整体关闭：每次挂载从首页重新请求，不复用历史分页。
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
  });
}

/** 手动「刷新」：丢弃所有筛选的列表缓存并让当前筛选从第一页重新加载 */
export function useRefreshKnowledgeBaseList() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.resetQueries({ queryKey: knowledgeKeys.baseListAll() }),
    [queryClient],
  );
}

export function useKnowledgeBase(id: string | undefined) {
  return useQuery<KnowledgeBase>({
    queryKey: knowledgeKeys.base(id ?? ''),
    queryFn: () => getKnowledgeBaseApi(id!),
    enabled: !!id,
  });
}

/** 创建知识库，成功后失效列表（重新拉取首页）。 */
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

/** 更新知识库（名称/描述/可见性），成功后失效详情与列表。 */
export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      input: UpdateKnowledgeBaseRequest;
    }) => updateKnowledgeBaseApi(variables.id, variables.input),
    onSuccess: async (_data, { id }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.base(id) }),
        queryClient.invalidateQueries({
          queryKey: knowledgeKeys.baseListAll(),
        }),
      ]);
    },
  });
}

/** 单独切换可见性：乐观改写详情与列表，成功后用服务端值收敛 */
export function useUpdateKnowledgeVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: VisibilityVariables) =>
      updateKnowledgeVisibilityApi(variables.id, variables.visibility),
    onMutate: async (variables) => ({
      rollback: await applyOptimistic(
        queryClient,
        visibilityCachePatches(variables.id, variables.visibility),
        variables,
      ),
    }),
    onSuccess: (updated) =>
      patchBaseInCache(queryClient, updated.id, {
        visibility: updated.visibility,
        updatedAt: updated.updatedAt,
      }),
    onError: (_error, variables, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, variables.id),
  });
}

/** 删除知识库：先从列表移除（可回滚），成功后清掉详情及其文档缓存 */
export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseApi(id),
    onMutate: async (id) => ({
      rollback: await applyOptimistic(queryClient, deleteCachePatches(id), id),
    }),
    onSuccess: (_data, id) => {
      // base(id) 前缀同时覆盖其下的 documents 缓存
      queryClient.removeQueries({ queryKey: knowledgeKeys.base(id) });
    },
    onError: (_error, id, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, id),
  });
}

/** 点赞知识库：乐观写入点赞态与计数，成功后用服务端返回值覆盖 */
export function useLikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => likeKnowledgeBaseApi(id),
    onMutate: async (id) => ({
      rollback: await applyOptimistic(
        queryClient,
        likeCachePatches(id, true),
        id,
      ),
    }),
    onSuccess: (result, id) =>
      patchBaseInCache(queryClient, id, {
        likeCount: result.likeCount,
        isLiked: result.isLiked,
      }),
    onError: (_error, id, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, id),
  });
}

/** 取消点赞知识库：同点赞，方向相反 */
export function useUnlikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlikeKnowledgeBaseApi(id),
    onMutate: async (id) => ({
      rollback: await applyOptimistic(
        queryClient,
        likeCachePatches(id, false),
        id,
      ),
    }),
    onSuccess: (result, id) =>
      patchBaseInCache(queryClient, id, {
        likeCount: result.likeCount,
        isLiked: result.isLiked,
      }),
    onError: (_error, id, context) =>
      rollbackAndRevalidate(queryClient, context?.rollback, id),
  });
}

// ==== 文档查询 ============================================================

/**
 * 页码分页的文档列表（知识库详情页的文件表格用）。
 * 缓存已整体关闭：翻页/上传/删除都按查询参数重新请求，不保留旧页数据。
 * kbId 或分页/筛选参数变化时 queryKey 整块变化，内容自然重取。
 */
export function useDocumentList(
  kbId: string | undefined,
  query: DocumentListQuery = {},
) {
  return useQuery<PageResult<KnowledgeDocumentListItem>>({
    queryKey: knowledgeKeys.documentList(kbId ?? '', query),
    queryFn: () => listDocumentsApi(kbId!, query),
    enabled: !!kbId,
  });
}

export function useDocument(kbId: string | undefined, id: string | undefined) {
  return useQuery<KnowledgeDocument>({
    queryKey: knowledgeKeys.document(kbId ?? '', id ?? ''),
    queryFn: () => getDocumentApi(kbId!, id!),
    enabled: !!kbId && !!id,
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
