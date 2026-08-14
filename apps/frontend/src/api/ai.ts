import type { AiStreamEvent } from '@lucy/shared';
import { http } from './client';
import type {
  Conversation,
  ConversationListResult,
  CreateConversationRequest,
  RenameConversationRequest,
  SendMessageRequest,
} from './types';

export function createConversationApi(input: CreateConversationRequest = {}) {
  return http.post<Conversation>('ai/conversations', input).json();
}

export function listConversationsApi(page = 1, pageSize = 20) {
  return http
    .get<ConversationListResult>('ai/conversations', { page, pageSize })
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
  return http.delete<{ success: boolean }>(`ai/conversations/${id}`).json();
}

export function streamSendMessageApi(
  conversationId: string,
  input: SendMessageRequest,
) {
  return http
    .post<AiStreamEvent>(`ai/conversations/${conversationId}/messages`, input, {
      extra: { skipAuthRefresh: true },
    })
    .stream();
}
