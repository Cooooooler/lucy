import { ApiError } from '@/api/client';
import {
  useConversationList,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '@/hooks/use-ai';
import { type ChatMessage, useChatStream } from '@/hooks/use-chat';
import { authStore } from '@/stores/auth.ts';
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  OllamaFilled,
  OpenAIOutlined,
  PlusOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Bubble,
  type BubbleProps,
  type ConversationItemType,
  Conversations,
  type ConversationsProps,
  Sender,
  Think,
  Welcome,
} from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type { RoleType } from '@ant-design/x/es/bubble/interface';
import type { ThinkProps } from '@ant-design/x/es/think/Think';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useBoolean } from 'ahooks';
import {
  App,
  Avatar,
  Button,
  Empty,
  Flex,
  Input,
  type InputRef,
  Result,
  Spin,
  Splitter,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import {
  type ComponentRef,
  type FC,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const { Text } = Typography;
const Switch = Sender.Switch;

export const Route = createFileRoute('/_layout/chat')({
  // /chat?id=<conversationId>：可选 id，缺省时首条消息无感创建会话
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ChatPage,
});

/** 思考折叠块：思考进行中展开并闪烁；完成/历史默认收起，用户可手动切换 */
function ThinkingBlock({
  children,
  thinkingActive,
}: Readonly<ThinkProps & { thinkingActive: boolean }>) {
  // override 记录用户手动切换；未手动时展开状态跟随 thinkingActive（思考中展开、完成/历史收起）
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? thinkingActive;
  return (
    <Think
      title="深度思考"
      loading={thinkingActive}
      blink={thinkingActive}
      expanded={expanded}
      onExpand={(v) => setOverride(v)}
    >
      {children}
    </Think>
  );
}

const renderMarkdown: BubbleProps['contentRender'] = (content, info) => {
  // info.extraInfo 为完整 ChatMessage：ai 消息若带 thinking（深度思考）则用 Think 折叠展示
  const msg = (info?.extraInfo ?? {}) as ChatMessage;
  const thinking = msg.thinking;
  // 思考进行中 = 还在流式且尚未产出回答
  const thinkingActive =
    Boolean(thinking) && Boolean(msg.streaming) && !msg.content;
  return (
    <div className={'flex flex-col gap-2'}>
      {thinking ? (
        <ThinkingBlock thinkingActive={thinkingActive}>
          <XMarkdown content={thinking} />
        </ThinkingBlock>
      ) : null}
      <XMarkdown content={content} />
      {msg.truncated ? (
        <div className="text-xs text-amber-600">
          ⚠️ 回复被截断（已达长度上限），可重新发送后再试
        </div>
      ) : null}
    </div>
  );
};

function ChatPage() {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const conversations = useConversationList();
  const rename = useRenameConversation();
  const remove = useDeleteConversation();
  const { modal } = App.useApp();
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const items = (conversations.data?.list ?? []).map((c) => ({
    key: c.id,
    label:
      renamingKey === c.id ? (
        <InlineRenameInput
          defaultValue={c.title ?? ''}
          onConfirm={(title) => {
            if (title) rename.mutate({ id: c.id, title });
            setRenamingKey(null);
          }}
          onCancel={() => setRenamingKey(null)}
        />
      ) : (
        (c.title ?? '新会话')
      ),
  }));

  function handleDelete(target: ConversationItemType) {
    modal.confirm({
      title: '删除会话',
      content: '删除后不可恢复，确认删除该会话？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await remove.mutateAsync(target.key);
        // 删除的是当前会话时，回到新建会话
        if (target.key === id) {
          await navigate({
            to: '/chat',
            search: { id: undefined },
            replace: true,
          });
        }
      },
    });
  }

  const menuConfig: ConversationsProps['menu'] = (conversation) => ({
    items: [
      {
        label: '重命名',
        key: 'rename',
        icon: <EditOutlined />,
      },
      {
        label: '删除会话',
        key: 'delete',
        icon: <DeleteOutlined />,
        danger: true,
      },
    ],
    onClick: (itemInfo) => {
      itemInfo.domEvent.stopPropagation();
      if (itemInfo.key === 'rename') {
        setRenamingKey(conversation.key);
      } else if (itemInfo.key === 'delete') {
        handleDelete(conversation);
      }
    },
  });

  return (
    <Splitter className="h-full" collapsible={{ motion: true }}>
      <Splitter.Panel defaultSize="15%" min="15%" max="40%">
        <Conversations
          menu={menuConfig}
          items={items}
          activeKey={id}
          onActiveChange={(key) =>
            navigate({ to: '/chat', search: { id: key }, replace: true })
          }
          creation={{
            label: <Text ellipsis>新建会话</Text>,
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
      <Splitter.Panel collapsible defaultSize="0%" min="15%" max="40%">
        <ThoughtChainPlaceholder />
      </Splitter.Panel>
    </Splitter>
  );
}

/**
 * # 行内重命名输入
 * 回车确认；失焦（点击外部）取消并恢复原标题。
 * doneRef 防止 Enter 提交后紧接着的 onBlur 又把取消分支执行一遍。
 */
function InlineRenameInput({
  defaultValue,
  onConfirm,
  onCancel,
}: Readonly<{
  defaultValue: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}>) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<InputRef>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    onConfirm(value.trim());
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPressEnter={commit}
      onBlur={cancel}
      onClick={(e) => e.stopPropagation()}
      size="small"
      className="w-full"
      maxLength={100}
    />
  );
}

const ChatMessagesArea: FC<{ id: string | undefined }> = ({ id }) => {
  const { messages, streaming, isLoading, error, send, stop } =
    useChatStream(id);
  const [value, setValue] = useState('');
  const [reasoning, setReasoning] = useState(true);
  const [creating, { setTrue: setCreatingTrue, setFalse: setCreatingFalse }] =
    useBoolean(false);
  const navigate = useNavigate();
  const create = useCreateConversation();
  const listRef = useRef<ComponentRef<typeof Bubble.List>>(null);
  const [atBottom, setAtBottom] = useState(true);

  // 响应式订阅 user：登录态变化时 header 昵称即时更新（get() 读取不会随 store 变更重渲染）
  const user = useSelector(authStore, (s) => s.user);

  const roles: RoleType = useMemo(() => {
    return {
      ai: {
        placement: 'start' as const,
        avatar: <Avatar icon={<OllamaFilled />} />,
        contentRender: renderMarkdown,
        header: <Text ellipsis>AI</Text>,
      },
      user: {
        placement: 'end' as const,
        avatar: <Avatar icon={<UserOutlined />} />,
        header: (_, info) => {
          const msg = info.extraInfo as ChatMessage;
          return (
            <div className="flex gap-2">
              <Text ellipsis>{user?.nickname ?? user?.username ?? ''}</Text>
              <Text ellipsis>
                {dayjs(msg.createdAt).format('YYYY-MM-DD HH:mm')}
              </Text>
            </div>
          );
        },
      },
    };
  }, [user]);

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
    const next = isReverse
      ? el.scrollTop >= -24
      : el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    // 值未变化时返回原 state，跳过无谓的滚动重渲染
    setAtBottom((prev) => (prev === next ? prev : next));
  }

  /** # 发送消息
   * @param text
   * 首条消息无感创建会话：若 id 缺省，先创建会话，再对新会话 id 发送消息；否则直接发送。
   */
  async function handleSubmit(text: string) {
    // 点击发送按钮后，输入框清空
    setValue('');
    if (id) {
      await send(id, text, reasoning);
      return;
    }
    setCreatingTrue();
    try {
      const conv = await create.mutateAsync({});
      await navigate({ to: '/chat', search: { id: conv.id }, replace: true });
      void send(conv.id, text, reasoning);
    } finally {
      setCreatingFalse();
    }
  }

  // 派生 items 缓存：messages 未变时保持引用稳定，避免 Bubble.List 因无关 state 重渲染
  const items = useMemo(
    () =>
      messages.map((m) => ({
        key: m.id,
        role: m.role,
        content: m.error ?? m.content,
        loading: Boolean(m.streaming && !m.content && !m.thinking),
        streaming: Boolean(m.streaming),
        extraInfo: m,
      })),
    [messages],
  );

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

  return (
    <Flex vertical className="h-full w-full">
      {id ? (
        <div className="relative min-h-0 flex-1 pt-8">
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
              color="cyan"
              shape="circle"
              icon={<DownOutlined />}
              className="absolute! bottom-9 left-1/2 z-10 -translate-x-1/2 shadow-md"
              onClick={() =>
                listRef.current?.scrollTo({ top: 'bottom', behavior: 'smooth' })
              }
            />
          )}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <Welcome
            variant="borderless"
            icon="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
            title="Hello, I'm Ant Design X"
            description="Base on Ant Design, AGI product interface solution, create a better intelligent vision~"
          />
        </div>
      )}
      <div className="px-4">
        <Sender
          footer={() => {
            return (
              <Flex justify="space-between" align="center">
                <Flex gap="small" align="center">
                  <Switch
                    value={reasoning}
                    onChange={(checked: boolean) => {
                      setReasoning(checked);
                    }}
                    icon={<OpenAIOutlined />}
                  >
                    <Text type="secondary" className="text-xs" ellipsis={true}>
                      深度思考
                    </Text>
                  </Switch>
                </Flex>
              </Flex>
            );
          }}
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
};

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
