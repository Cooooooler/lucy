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
  // 会话列表查询（带分页参数）
  conversationList: (page = 1, pageSize = 20) =>
    [...aiKeys.conversations(), 'list', { page, pageSize }] as const,
  conversation: (id: string) => [...aiKeys.conversations(), id] as const,
};

// 列表失效前缀：命中所有页的列表查询，但不会误伤单个会话（conversation(id) 无 'list' 段）
export const conversationListAll = [...aiKeys.conversations(), 'list'] as const;

export function useConversationList(page = 1, pageSize = 20) {
  return useQuery<ConversationListResult>({
    queryKey: aiKeys.conversationList(page, pageSize),
    queryFn: () => listConversationsApi(page, pageSize),
    placeholderData: (prev) => prev,
    // AI 数据不信任缓存：会话列表标题/排序会随消息变化，需实时拉最新
    staleTime: 0,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery<Conversation>({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: () => getConversationApi(id!),
    enabled: !!id,
    // 同上：历史消息必须实时，否则切回会话会看到旧内容（缺新发的消息）
    staleTime: 0,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationRequest) =>
      createConversationApi(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationListAll });
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
      queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversationApi(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: aiKeys.conversation(id) });
      queryClient.invalidateQueries({ queryKey: conversationListAll });
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
    onSuccess: (_stream, { conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: aiKeys.conversation(conversationId),
      });
      queryClient.invalidateQueries({ queryKey: conversationListAll });
    },
  });
}
