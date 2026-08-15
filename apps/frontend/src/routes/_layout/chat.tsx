import { ApiError } from '@/api/client';
import {
  conversationListAll,
  useConversationList,
  useCreateConversation,
} from '@/hooks/use-ai';
import { useChatStream } from '@/hooks/use-chat';
import {
  DownOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Bubble, type BubbleProps, Conversations, Sender } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Avatar,
  Button,
  Empty,
  Flex,
  Result,
  Spin,
  Splitter,
  Typography,
} from 'antd';
import {
  type ComponentRef,
  type UIEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

export const Route = createFileRoute('/_layout/chat')({
  // /chat?id=<conversationId>：可选 id，缺省时首条消息无感创建会话
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ChatPage,
});

const renderMarkdown: BubbleProps['contentRender'] = (content) => {
  return (
    <Typography>
      <XMarkdown content={content} />
    </Typography>
  );
};

// 组件外定义，保持引用稳定（避免重置打字动画）
const roles = {
  assistant: {
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
  const queryClient = useQueryClient();
  const conversations = useConversationList(1, 50);
  const items = (conversations.data?.list ?? []).map((c) => ({
    key: c.id,
    label: c.title ?? '新会话',
  }));

  // 切换会话时实时刷新左栏列表：首条消息后标题由后端异步生成（generateTitle），
  // 早于列表刷新完成，故每次切换都失效重拉，保证标题/排序最新。
  // 仅实际切换时失效（跳过首帧），避免挂载时重复请求。
  const prevIdRef = useRef(id);
  useEffect(() => {
    if (prevIdRef.current === id) return;
    prevIdRef.current = id;
    queryClient.invalidateQueries({ queryKey: conversationListAll });
  }, [id, queryClient]);

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
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const create = useCreateConversation();
  const pendingRef = useRef<string | null>(null);
  const listRef = useRef<ComponentRef<typeof Bubble.List>>(null);
  const [atBottom, setAtBottom] = useState(true);

  // 首条消息无感创建：id 从无到有后发送暂存的首条消息（query 变化不重挂载，恰好走 sentRef 守卫）
  useEffect(() => {
    if (id && pendingRef.current) {
      const text = pendingRef.current;
      pendingRef.current = null;
      void send(text);
    }
  }, [id, send]);

  // Bubble.List 会把 onScroll 转发到内部滚动盒（scrollBoxNativeElement）。
  // autoScroll 开启时滚动盒是 column-reverse，scrollTop 语义反转（0 = 底部，向上滚为负值），须分别判定。
  // 初始态 true（autoScroll 加载即贴底），之后状态只由滚动事件驱动，避免 effect 中同步 setState。
  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const isReverse = getComputedStyle(el).flexDirection === 'column-reverse';
    setAtBottom(
      isReverse
        ? el.scrollTop >= -24
        : el.scrollHeight - el.scrollTop - el.clientHeight < 24,
    );
  }

  async function handleSubmit(text: string) {
    setValue('');
    if (id) {
      await send(text);
      return;
    }
    setCreating(true);
    try {
      const conv = await create.mutateAsync({});
      pendingRef.current = text;
      await navigate({ to: '/chat', search: { id: conv.id }, replace: true });
    } finally {
      setCreating(false);
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
    key: m.key,
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
          loading={streaming || creating}
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
