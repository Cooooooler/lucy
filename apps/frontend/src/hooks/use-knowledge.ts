import {
  addDocumentApi,
  createKnowledgeBaseApi,
  deleteDocumentApi,
  deleteKnowledgeBaseApi,
  getDocumentApi,
  getKnowledgeBaseApi,
  listDocumentsApi,
  listKnowledgeBasesApi,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  // 知识库维度
  bases: () => [...knowledgeKeys.all, 'bases'] as const,
  // 列表失效前缀：只命中知识库列表查询（documents 段不在该前缀下，不会被误伤）
  baseListAll: () => [...knowledgeKeys.bases(), 'list'] as const,
  // 列表查询（含分页参数）
  baseList: (query: KnowledgeListQuery = {}) =>
    [...knowledgeKeys.baseListAll(), query] as const,
  base: (id: string) => [...knowledgeKeys.bases(), id] as const,
  // 文档维度：嵌在某个知识库下，key 携带 kbId 自动隔离
  documents: (kbId: string) =>
    [...knowledgeKeys.bases(), kbId, 'documents'] as const,
  documentList: (kbId: string, query: DocumentListQuery = {}) =>
    [...knowledgeKeys.documents(kbId), 'list', query] as const,
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
