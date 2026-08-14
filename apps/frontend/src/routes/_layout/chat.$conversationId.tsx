import { ApiError } from '@/api/client';
import { useChatStream } from '@/hooks/use-chat';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble, Sender } from '@ant-design/x';
import { createFileRoute } from '@tanstack/react-router';
import { Avatar, Flex, Result, Spin } from 'antd';
import { useState } from 'react';

export const Route = createFileRoute('/_layout/chat/$conversationId')({
  component: ChatPage,
});

// 组件外定义，保持引用稳定（避免重置打字动画）
const role = {
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
  const { conversationId } = Route.useParams();
  return (
    <ChatMessagesArea key={conversationId} conversationId={conversationId} />
  );
}

function ChatMessagesArea({ conversationId }: { conversationId: string }) {
  const { messages, streaming, isLoading, error, send, stop } =
    useChatStream(conversationId);
  const [value, setValue] = useState('');

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
        <Bubble.List items={items} role={role} autoScroll />
      </div>
      <div className="px-4 pb-4">
        <Sender
          value={value}
          onChange={setValue}
          onSubmit={(text) => {
            setValue('');
            send(text);
          }}
          loading={streaming}
          onCancel={stop}
          placeholder="输入消息，Enter 发送"
        />
      </div>
    </Flex>
  );
}
