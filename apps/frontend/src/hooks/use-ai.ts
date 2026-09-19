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
  ConversationItem,
  CreateConversationRequest,
  RenameConversationRequest,
  SendMessageRequest,
} from '@/api/types';
import type { CursorPageResult } from '@lucy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const aiKeys = {
  all: ['ai'] as const,
  conversations: () => [...aiKeys.all, 'conversations'] as const,
  // 会话列表查询（游标分页：只需第一页，故不带游标）
  conversationList: () => [...aiKeys.conversations(), 'list'] as const,
  conversation: (id: string) => [...aiKeys.conversations(), id] as const,
};

// 列表失效前缀：命中所有页的列表查询，但不会误伤单个会话（conversation(id) 无 'list' 段）
export const conversationListAll = [...aiKeys.conversations(), 'list'] as const;

export function useConversationList() {
  return useQuery<CursorPageResult<ConversationItem>>({
    queryKey: aiKeys.conversationList(),
    queryFn: () => listConversationsApi(),
    placeholderData: (prev) => prev,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery<Conversation>({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: () => getConversationApi(id!),
    enabled: !!id,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationRequest) =>
      createConversationApi(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string } & RenameConversationRequest) =>
      renameConversationApi(id, { title }),
    onSuccess: async (_updated) => {
      await queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversationApi(id),
    onSuccess: async (_data, _id) => {
      await queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}

export interface SendMessageVariables {
  conversationId: string;
  input: SendMessageRequest;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    // 返回事件流对象供消费方迭代；mutation 随即 resolve，onSuccess 仅触发查询失效
    mutationFn: async ({ conversationId, input }: SendMessageVariables) =>
      streamSendMessageApi(conversationId, input),
    onSuccess: async (_stream, { conversationId }) => {
      await queryClient.invalidateQueries({
        queryKey: aiKeys.conversation(conversationId),
      });
      await queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}
