import type {
  AiStreamEvent,
  ConversationListQuery,
  CursorPageResult,
} from '@lucy/shared';
import { http } from './client';
import type {
  Conversation,
  ConversationItem,
  CreateConversationRequest,
  RenameConversationRequest,
  SendMessageRequest,
} from './types';

// AI 会话/消息 REST 客户端：全部经 http 实例（自动附加 Bearer + 401 单飞刷新 + 信封解包）。
// 流式发送标记 skipAuthRefresh：SSE 流中途不应触发 401 重放，否则会破坏流协议。

export function createConversationApi(input: CreateConversationRequest = {}) {
  return http.post<Conversation>('ai/conversations', input).json();
}

// 会话列表为游标分页（按最近活跃倒序），列表项是允许式白名单 ConversationItem；
// 响应结构复用共享 CursorPageResult<T>，查询参数类型由共享包从生成的 operations 派生
export function listConversationsApi(query: ConversationListQuery = {}) {
  return http
    .get<CursorPageResult<ConversationItem>>('ai/conversations', query)
    .json();
}

export function getConversationApi(id: string) {
  return http.get<Conversation>(`ai/conversations/${id}`).json();
}

export function renameConversationApi(
  id: string,
  input: RenameConversationRequest,
) {
  return http.patch<Conversation>(`ai/conversations/${id}`, input).json();
}

export function deleteConversationApi(id: string) {
  return http.delete<null>(`ai/conversations/${id}`).json();
}

export function createStreamRequest(
  conversationId: string,
  input: SendMessageRequest,
) {
  return http.post<AiStreamEvent>(
    `ai/conversations/${conversationId}/messages`,
    input,
    {
      extra: { skipAuthRefresh: true },
    },
  );
}

export function streamSendMessageApi(
  conversationId: string,
  input: SendMessageRequest,
) {
  return createStreamRequest(conversationId, input).stream();
}
