import type {
  DocumentListQuery,
  KnowledgeListQuery,
  PageResult,
} from '@lucy/shared';
import { http } from './client';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeDocument,
  UpdateKnowledgeBaseRequest,
} from './types';

// 知识库/文档 REST 客户端：全部经 http 实例（自动附加 Bearer + 401 单飞刷新 + 信封解包）。
// 分页响应结构复用共享 PageResult<T>；列表接口经 `http.get` 以 query 参数发送。
// 查询参数类型（KnowledgeListQuery/DocumentListQuery）由共享包从生成的 operations 派生导出。

export function createKnowledgeBaseApi(input: CreateKnowledgeBaseRequest) {
  return http.post<KnowledgeBase>('knowledge', input).json();
}

export function listKnowledgeBasesApi(query: KnowledgeListQuery = {}) {
  return http.get<PageResult<KnowledgeBase>>('knowledge', query).json();
}

export function getKnowledgeBaseApi(id: string) {
  return http.get<KnowledgeBase>(`knowledge/${id}`).json();
}

export function updateKnowledgeBaseApi(
  id: string,
  input: UpdateKnowledgeBaseRequest,
) {
  return http.patch<KnowledgeBase>(`knowledge/${id}`, input).json();
}

export function deleteKnowledgeBaseApi(id: string) {
  return http.delete<null>(`knowledge/${id}`).json();
}

// 上传文档：multipart/form-data，字段名 file。FormData 经 http 原样透传，
// 由 client 的 multipart 插件去除默认 Content-Type，交给 fetch 生成 boundary。
export function addDocumentApi(kbId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return http
    .post<KnowledgeDocument>(`knowledge/${kbId}/documents`, form)
    .json();
}

export function listDocumentsApi(kbId: string, query: DocumentListQuery = {}) {
  return http
    .get<PageResult<KnowledgeDocument>>(`knowledge/${kbId}/documents`, query)
    .json();
}

export function getDocumentApi(kbId: string, id: string) {
  return http
    .get<KnowledgeDocument>(`knowledge/${kbId}/documents/${id}`)
    .json();
}

export function deleteDocumentApi(kbId: string, id: string) {
  return http.delete<null>(`knowledge/${kbId}/documents/${id}`).json();
}
