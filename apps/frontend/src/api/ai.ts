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

// 创建/改名返回列表项同一份允许式契约（服务端不 populate messages，自然也不该出现在契约里）
export function createConversationApi(input: CreateConversationRequest = {}) {
  // 首条消息无感创建会话（chat.tsx handleSubmit）：静默，不弹「会话创建成功」
  return http
    .post<ConversationItem>('ai/conversations', input, {
      extra: { skipSuccessMessage: true },
    })
    .json();
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
  return http.patch<ConversationItem>(`ai/conversations/${id}`, input).json();
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
      // SSE 流：不走 json 解包本就不会广播；双保险标记静默
      extra: { skipAuthRefresh: true, skipSuccessMessage: true },
    },
  );
}

export function streamSendMessageApi(
  conversationId: string,
  input: SendMessageRequest,
) {
  return createStreamRequest(conversationId, input).stream();
}
