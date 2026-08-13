import {
  createConversationApi,
  deleteConversationApi,
  getConversationApi,
  listConversationsApi,
  renameConversationApi,
  streamSendMessageApi,
} from '@/api/ai';
import type {
  Conversation,
  ConversationListResult,
  CreateConversationRequest,
  RenameConversationRequest,
  SendMessageRequest,
} from '@/api/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const aiKeys = {
  all: ['ai'] as const,
  conversations: () => [...aiKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...aiKeys.conversations(), id] as const,
};

export function useConversationList(page = 1, pageSize = 20) {
  return useQuery<ConversationListResult>({
    queryKey: [...aiKeys.conversations(), { page, pageSize }],
    queryFn: () => listConversationsApi(page, pageSize),
    placeholderData: (prev) => prev,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery<Conversation>({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: () => getConversationApi(id!),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationRequest) =>
      createConversationApi(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string } & RenameConversationRequest) =>
      renameConversationApi(id, { title }),
    onSuccess: (updated) => {
      queryClient.setQueryData(aiKeys.conversation(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversationApi(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: aiKeys.conversation(id) });
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
  });
}

export interface SendMessageVariables {
  conversationId: string;
  input: SendMessageRequest;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      input,
      onDelta,
      signal,
    }: SendMessageVariables) =>
      streamSendMessageApi(conversationId, input, onDelta, signal),
    onSuccess: (_full, { conversationId }) => {
      // 流结束：详情已含完整 assistant 消息，列表可能已异步生成标题
      queryClient.invalidateQueries({
        queryKey: aiKeys.conversation(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: aiKeys.conversations() });
    },
  });
}
