import { ApiError } from '@/api/client';
import { useConversationList, useCreateConversation } from '@/hooks/use-ai';
import { useChatStream } from '@/hooks/use-chat';
import {
  DownOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Bubble, type BubbleProps, Conversations, Sender } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type { RoleType } from '@ant-design/x/es/bubble/interface';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useBoolean } from 'ahooks';
import { Avatar, Button, Empty, Flex, Result, Spin, Splitter } from 'antd';
import { type ComponentRef, type UIEvent, useRef, useState } from 'react';

export const Route = createFileRoute('/_layout/chat')({
  // /chat?id=<conversationId>：可选 id，缺省时首条消息无感创建会话
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ChatPage,
});

const renderMarkdown: BubbleProps['contentRender'] = (content) => {
  return <XMarkdown content={content} />;
};

// 组件外定义，保持引用稳定（避免重置打字动画）
const roles: RoleType = {
  ai: {
    placement: 'start' as const,
    avatar: <Avatar icon={<RobotOutlined />} />,
    contentRender: renderMarkdown,
  },
  user: {
    placement: 'end' as const,
    avatar: <Avatar icon={<UserOutlined />} />,
  },
};

function ChatPage() {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const conversations = useConversationList();
  const items = (conversations.data?.list ?? []).map((c) => ({
    key: c.id,
    label: c.title ?? '新会话',
  }));

  return (
    <Splitter className="h-full" collapsible={{ motion: true }}>
      <Splitter.Panel collapsible defaultSize="15%" min="15%" max="40%">
        <Conversations
          items={items}
          activeKey={id}
          onActiveChange={(key) =>
            navigate({ to: '/chat', search: { id: key }, replace: true })
          }
          creation={{
            label: '新建会话',
            icon: <PlusOutlined />,
            onClick: () =>
              navigate({
                to: '/chat',
                search: { id: undefined },
                replace: true,
              }),
          }}
        />
      </Splitter.Panel>
      <Splitter.Panel>
        <ChatMessagesArea id={id} />
      </Splitter.Panel>
      <Splitter.Panel collapsible defaultSize="15%" min="15%" max="40%">
        <ThoughtChainPlaceholder />
      </Splitter.Panel>
    </Splitter>
  );
}

function ChatMessagesArea({ id }: Readonly<{ id: string | undefined }>) {
  const { messages, streaming, isLoading, error, send, stop } =
    useChatStream(id);
  const [value, setValue] = useState('');
  const [creating, { setTrue: setCreatingTrue, setFalse: setCreatingFalse }] =
    useBoolean(false);
  const navigate = useNavigate();
  const create = useCreateConversation();
  const listRef = useRef<ComponentRef<typeof Bubble.List>>(null);
  const [atBottom, setAtBottom] = useState(true);

  /**
   * # 滚动事件处理
   * @param e
   * Bubble.List 会把 onScroll 转发到内部滚动盒（scrollBoxNativeElement）。
   * autoScroll 开启时滚动盒是 column-reverse，scrollTop 语义反转（0 = 底部，向上滚为负值），须分别判定。
   * 初始态 true（autoScroll 加载即贴底），之后状态只由滚动事件驱动，避免 effect 中同步 setState。
   */
  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const isReverse = getComputedStyle(el).flexDirection === 'column-reverse';
    setAtBottom(
      isReverse
        ? el.scrollTop >= -24
        : el.scrollHeight - el.scrollTop - el.clientHeight < 24,
    );
  }

  /** # 发送消息
   * @param text
   * 首条消息无感创建会话：若 id 缺省，先创建会话，再对新会话 id 发送消息；否则直接发送。
   */
  async function handleSubmit(text: string) {
    // 点击发送按钮后，输入框清空
    setValue('');
    if (id) {
      await send(id, text);
      return;
    }
    setCreatingTrue();
    try {
      const conv = await create.mutateAsync({});
      await navigate({ to: '/chat', search: { id: conv.id }, replace: true });
      void send(conv.id, text);
    } finally {
      setCreatingFalse();
    }
  }

  if (isLoading) {
    return (
      <Flex className="h-full w-full" align="center" justify="center">
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
    key: m.id,
    role: m.role,
    content: m.error ?? m.content,
    loading: Boolean(m.streaming && !m.content),
    streaming: Boolean(m.streaming),
  }));

  return (
    <Flex vertical className="h-full w-full">
      <div className="relative min-h-0 flex-1">
        <Bubble.List
          ref={listRef}
          items={items}
          role={roles}
          autoScroll
          onScroll={handleScroll}
          className="h-full pb-4"
          classNames={{ scroll: 'scrollbar-hide' }}
        />
        {!atBottom && (
          <Button
            type="primary"
            shape="circle"
            icon={<DownOutlined />}
            className="absolute! bottom-16 left-1/2 z-10 -translate-x-1/2 shadow-md"
            onClick={() =>
              listRef.current?.scrollTo({ top: 'bottom', behavior: 'smooth' })
            }
          />
        )}
      </div>
      <div className="px-4">
        <Sender
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          loading={streaming ?? creating}
          onCancel={stop}
          placeholder="输入消息，Enter 发送"
        />
      </div>
    </Flex>
  );
}

function ThoughtChainPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="思考过程（待接入）"
      />
    </div>
  );
}
