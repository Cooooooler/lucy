import { createStreamRequest } from '@/api/ai';
import type { AiStreamEvent } from '@lucy/shared';
import { useHookFetch } from 'hook-fetch/react';
import { useEffect, useRef, useState } from 'react';
import { useConversation } from './use-ai';

export interface ChatMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
}

export function useChatStream(conversationId: string | undefined) {
  const conversationQuery = useConversation(conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const initializedRef = useRef(false);
  const sentRef = useRef(false);
  const currentIdRef = useRef(conversationId);

  const { stream, cancel } = useHookFetch({
    request: createStreamRequest,
    onError: () => {},
  });

  // useHookFetch 的 cancel 每次渲染重建（引用不稳定），用 ref 持有以便卸载时调用
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(
    () => () => {
      cancelRef.current();
    },
    [],
  );

  // 会话 id 变化（/chat?id= 的 query 参数变化不重挂载）：重置消息与守卫，重新加载历史
  useEffect(() => {
    if (currentIdRef.current === conversationId) return;
    currentIdRef.current = conversationId;
    initializedRef.current = false;
    sentRef.current = false;
    streamingRef.current = false;
    setStreaming(false);
    setMessages([]);
  }, [conversationId]);

  // 历史只在首次数据到达时注入；一旦已 send（sentRef）或已初始化，不再注入，避免覆盖流式状态。
  // 这里的 setMessages 是一次性历史注入（initializedRef 守卫），非响应式派生，故豁免告警。
  useEffect(() => {
    if (initializedRef.current || sentRef.current || !conversationQuery.data)
      return;
    initializedRef.current = true;
    // eslint-disable-next-line react-x/set-state-in-effect
    setMessages(
      (conversationQuery.data.messages ?? [])
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          key: m.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          error:
            m.role === 'assistant' &&
            (m.status === 'failed' || m.status === 'aborted')
              ? m.status === 'failed'
                ? '生成失败'
                : '生成中断'
              : undefined,
        })),
    );
  }, [conversationQuery.data]);

  async function send(content: string) {
    const text = content.trim();
    if (!conversationId || streamingRef.current || !text) return;
    sentRef.current = true;
    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { key: userKey, role: 'user', content: text },
      { key: assistantKey, role: 'assistant', content: '', streaming: true },
    ]);
    streamingRef.current = true;
    setStreaming(true);
    try {
      for await (const chunk of stream(conversationId, { content: text })) {
        const event = chunk.result as AiStreamEvent | null;
        if (!event) continue;
        if (event.type === 'delta') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey
                ? { ...m, content: m.content + event.data.content }
                : m,
            ),
          );
        } else if (event.type === 'error') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey
                ? { ...m, streaming: false, error: event.data.message }
                : m,
            ),
          );
        } else if (event.type === 'done') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey ? { ...m, streaming: false } : m,
            ),
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.key === assistantKey
            ? { ...m, streaming: false, error: '生成中断' }
            : m,
        ),
      );
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.key === assistantKey ? { ...m, streaming: false } : m,
        ),
      );
      streamingRef.current = false;
      setStreaming(false);
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
