import type {
  CursorPageResult,
  DocumentListQuery,
  KnowledgeListQuery,
  components,
} from '@lucy/shared';
import { http } from './client.js';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeDocumentListItem,
  UpdateKnowledgeBaseRequest,
} from './types.js';

type LikeResultDto = components['schemas']['LikeResultDto'];

// 知识库/文档 REST 客户端：全部经 http 实例（自动附加 Bearer + 401 单飞刷新 + 信封解包）。
// 列表为游标分页，响应结构复用共享 CursorPageResult<T>（nextCursor 为空表示已到末页）；
// 查询参数类型（KnowledgeListQuery/DocumentListQuery）由共享包从生成的 operations 派生导出。

export function createKnowledgeBaseApi(input: CreateKnowledgeBaseRequest) {
  return http.post<KnowledgeBase>('knowledge', input).json();
}

export function listKnowledgeBasesApi(query: KnowledgeListQuery = {}) {
  return http.get<CursorPageResult<KnowledgeBase>>('knowledge', query).json();
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

export function likeKnowledgeBaseApi(id: string) {
  // 点赞高频且当前无 toast 预期：静默，避免打断浏览
  return http
    .post<LikeResultDto>(`knowledge/${id}/like`, undefined, {
      extra: { skipSuccessMessage: true },
    })
    .json();
}

export function unlikeKnowledgeBaseApi(id: string) {
  return http
    .delete<LikeResultDto>(`knowledge/${id}/like`, {
      extra: { skipSuccessMessage: true },
    })
    .json();
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

// 列表返回的是列表项（不含解析全文 content），详情接口才返回 KnowledgeDocument
export function listDocumentsApi(kbId: string, query: DocumentListQuery = {}) {
  return http
    .get<CursorPageResult<KnowledgeDocumentListItem>>(
      `knowledge/${kbId}/documents`,
      query,
    )
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
