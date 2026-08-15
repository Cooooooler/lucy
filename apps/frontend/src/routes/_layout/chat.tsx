import { createConversationApi } from '@/api/ai';
import { ApiError } from '@/api/client';
import { useChatStream } from '@/hooks/use-chat';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble, Sender } from '@ant-design/x';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Avatar, Flex, Result, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/_layout/chat')({
  // /chat?id=<conversationId>：可选 id，缺省时首条消息无感创建会话
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ChatPage,
});

// 组件外定义，保持引用稳定（避免重置打字动画）
const roles = {
  assistant: {
    placement: 'start' as const,
    avatar: <Avatar icon={<RobotOutlined />} />,
  },
  user: {
    placement: 'end' as const,
    avatar: <Avatar icon={<UserOutlined />} />,
  },
};

function ChatPage() {
  const { id } = Route.useSearch();
  const { messages, streaming, isLoading, error, send, stop } =
    useChatStream(id);
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const pendingRef = useRef<string | null>(null);

  // 首条消息无感创建：id 从无到有后发送暂存的首条消息（query 变化不重挂载，恰好走 sentRef 守卫）
  useEffect(() => {
    if (id && pendingRef.current) {
      const text = pendingRef.current;
      pendingRef.current = null;
      send(text);
    }
  }, [id]);

  async function handleSubmit(text: string) {
    setValue('');
    if (id) {
      send(text);
      return;
    }
    setCreating(true);
    try {
      const conv = await createConversationApi({});
      pendingRef.current = text;
      navigate({ to: '/chat', search: { id: conv.id }, replace: true });
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) {
    return (
      <Flex className="h-full" align="center" justify="center">
        <Spin />
      </Flex>
    );
  }
  if (error) {
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <Result
        status="warning"
        title={isNotFound ? '会话不存在' : '加载失败'}
        subTitle={isNotFound ? '请检查会话 ID' : '请稍后重试'}
      />
    );
  }

  const items = messages.map((m) => ({
    key: m.key,
    role: m.role,
    content: m.error ?? m.content,
    loading: Boolean(m.streaming && !m.content),
    streaming: Boolean(m.streaming),
  }));

  return (
    <Flex vertical className="h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Bubble.List items={items} role={roles} autoScroll />
      </div>
      <div className="px-4 pb-4">
        <Sender
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          loading={streaming || creating}
          onCancel={stop}
          placeholder="输入消息，Enter 发送"
        />
      </div>
    </Flex>
  );
}
