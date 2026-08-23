import { createStreamRequest } from '@/api/ai';
import type { Message } from '@/api/types.ts';
import type { AiStreamEvent } from '@lucy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useHookFetch } from 'hook-fetch/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { conversationListAll, useConversation } from './use-ai';

export interface ChatMessage extends Message {
  streaming?: boolean;
  error?: string;
  thinking?: string;
}

// ai 消息的 failed/aborted 状态映射为错误文案，其余状态返回 undefined（无错误）
const getAiStatusText = (m: Message) => {
  if (m.role !== 'ai') return undefined;
  if (m.status !== 'failed' && m.status !== 'aborted') return undefined;
  return m.status === 'failed' ? '生成失败' : '生成中断';
};

// 服务端消息 → UI 消息：补 error 文案
const toChatMessage = (m: Message): ChatMessage => ({
  ...m,
  error: getAiStatusText(m),
});

// 乐观消息的临时 id（服务端历史用真实 id，二者以 id 作为渲染/更新键）
let msgSeq = 0;
const tmpId = (prefix: string) => `${prefix}-${Date.now()}-${msgSeq++}`;

export function useChatStream(conversationId: string | undefined) {
  const conversationQuery = useConversation(conversationId);
  const queryClient = useQueryClient();

  // 服务端历史：只读派生，永不作为流式写入目标
  const historyMessages = useMemo<ChatMessage[]>(
    () => (conversationQuery.data?.messages ?? []).map(toChatMessage),
    [conversationQuery.data],
  );

  // 流式消息：本次会话乐观追加的 user/ai，作为历史之上的尾部覆盖层。
  // 与历史分开存储，服务端快照永远覆盖不到，天然规避「晚到的空历史清空乐观消息」。
  const [live, setLive] = useState<ChatMessage[]>([]);
  // live 所属会话；换会话时据此判断是否需要清空重来
  const liveConvRef = useRef<string | null>(null);

  // 流式态：live 中是否有正在生成的 ai 气泡（换会话自动归零，无需单独重置）
  const streaming = live.some((m) => m.role === 'ai' && m.streaming);

  const { stream, cancel } = useHookFetch({
    request: createStreamRequest,
    onError: () => {},
  });

  // useHookFetch 的 cancel 每次渲染重建（引用不稳定），用 ref 持有，卸载/切会话时安全调用
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // 切换会话或卸载：中止在途流；若离开 live 所属会话则清空它
  useEffect(() => {
    if (liveConvRef.current !== conversationId) {
      setLive([]);
      liveConvRef.current = conversationId ?? null;
    }
    return () => cancelRef.current();
  }, [conversationId]);

  // 单一渲染源 = 历史 + 流式覆盖
  const messages = useMemo<ChatMessage[]>(
    () => [...historyMessages, ...live],
    [historyMessages, live],
  );

  // 只替换被更新的那条消息，其余保持引用稳定，便于下游 memo 组件跳过未变气泡的重复渲染
  function updateMessage(id: string, updater: (m: ChatMessage) => ChatMessage) {
    setLive((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.id !== id) return m;
        const updated = updater(m);
        if (updated === m) return m;
        changed = true;
        return updated;
      });
      return changed ? next : prev;
    });
  }

  // 追加本次会话的乐观 user + ai 占位，返回 ai 临时 id 供流式过程定位
  function appendOptimistic(conversationId: string, text: string) {
    const now = new Date().toISOString();
    const userId = tmpId('user');
    const aiId = tmpId('ai');
    setLive((prev) => [
      ...(liveConvRef.current === conversationId ? prev : []),
      {
        id: userId,
        conversationId,
        role: 'user',
        content: text,
        status: 'complete',
        createdAt: now,
      },
      {
        id: aiId,
        conversationId,
        role: 'ai',
        content: '',
        status: null,
        createdAt: now,
        streaming: true,
      },
    ]);
    liveConvRef.current = conversationId;
    return aiId;
  }

  async function send(
    conversationId: string | undefined,
    content: string,
    reasoning = false,
  ) {
    if (!conversationId) return;
    const text = content.trim();
    const aiId = appendOptimistic(conversationId, text);
    try {
      // 逐帧消费事件流：delta 累积内容，done/error 结束流式态
      for await (const chunk of stream(conversationId, {
        content: text,
        reasoning,
      })) {
        const event = chunk.result as AiStreamEvent | null;
        if (!event) continue;
        if (event.type === 'delta') {
          updateMessage(aiId, (m) => ({
            ...m,
            content: m.content + (event.data.content ?? ''),
            thinking: (m.thinking ?? '') + (event.data.thinking ?? ''),
          }));
        } else if (event.type === 'error') {
          updateMessage(aiId, (m) => ({
            ...m,
            streaming: false,
            error: event.data.message,
          }));
        } else if (event.type === 'done') {
          updateMessage(aiId, (m) => ({ ...m, streaming: false }));
        }
      }
    } catch {
      // 流抛错（如网络中断）：把 ai 消息标记为中断
      updateMessage(aiId, (m) => ({
        ...m,
        streaming: false,
        error: '生成中断',
      }));
    } finally {
      // 无论成功/失败/中断都收尾：结束流式态，并让左栏会话列表刷新
      // （首条消息后标题会自动生成、排序可能变化）
      updateMessage(aiId, (m) => ({ ...m, streaming: false }));
      await queryClient.invalidateQueries({ queryKey: conversationListAll });
    }
  }

  function stop() {
    cancel();
  }

  return {
    messages,
    streaming,
    isLoading: conversationQuery.isLoading,
    error: conversationQuery.error,
    send,
    stop,
  };
}
