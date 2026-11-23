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
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';

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
    refetchOnWindowFocus: false,
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
    refetchOnWindowFocus: false,
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

/** 单独切换可见性：独立端点，成功后失效详情与列表。 */
export function useUpdateKnowledgeVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      id: string;
      visibility: KnowledgeBaseVisibility;
    }) => updateKnowledgeVisibilityApi(variables.id, variables.visibility),
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

/** 删除知识库，成功后清掉详情缓存并失效列表。 */
export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeBaseApi(id),
    onSuccess: async (_data, id) => {
      // base(id) 前缀同时覆盖其下的 documents 缓存
      queryClient.removeQueries({ queryKey: knowledgeKeys.base(id) });
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.baseListAll(),
      });
    },
  });
}

/** 点赞知识库，成功后失效详情与列表（重新拉取真实点赞态）。 */
export function useLikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => likeKnowledgeBaseApi(id),
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.base(id) }),
        queryClient.invalidateQueries({
          queryKey: knowledgeKeys.baseListAll(),
        }),
      ]);
    },
  });
}

/** 取消点赞知识库，成功后失效详情与列表。 */
export function useUnlikeKnowledgeBase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlikeKnowledgeBaseApi(id),
    onSuccess: async (_data, id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.base(id) }),
        queryClient.invalidateQueries({
          queryKey: knowledgeKeys.baseListAll(),
        }),
      ]);
    },
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
    refetchOnWindowFocus: false,
  });
}

export function useDocument(kbId: string | undefined, id: string | undefined) {
  return useQuery<KnowledgeDocument>({
    queryKey: knowledgeKeys.document(kbId ?? '', id ?? ''),
    queryFn: () => getDocumentApi(kbId!, id!),
    enabled: !!kbId && !!id,
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
