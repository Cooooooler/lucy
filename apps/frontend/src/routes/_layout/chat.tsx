import { errorStatusOf } from '@/api/client';
import { PageShell } from '@/components/page-shell';
import {
  useConversationList,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '@/hooks/use-ai';
import { type ChatMessage, useChatStream } from '@/hooks/use-chat';
import { useLlmModelProviders } from '@/hooks/use-model-provider';
import { authStore } from '@/stores/auth.ts';
import {
  AppstoreOutlined,
  BugOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  OllamaFilled,
  OpenAIOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Bubble,
  type BubbleProps,
  CodeHighlighter,
  type ConversationItemType,
  Conversations,
  type ConversationsProps,
  Prompts,
  Sender,
  type SenderProps,
  Think,
  Welcome,
} from '@ant-design/x';
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown';
import type { RoleType } from '@ant-design/x/es/bubble/interface';
import type { ThinkProps } from '@ant-design/x/es/think/Think';
import { CONVERSATION_TITLE_MAX_LENGTH } from '@lucy/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useBoolean } from 'ahooks';
import {
  Alert,
  App,
  Avatar,
  Button,
  Dropdown,
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
  type CSSProperties,
  type FC,
  type ReactNode,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const { Text } = Typography;

/** 空状态快捷提问：点击只填入输入框（保留修改余地），不直接发送 */
const QUICK_PROMPTS = [
  {
    key: 'summary',
    icon: <FileTextOutlined />,
    label: '总结知识库里最近上传的文档',
  },
  { key: 'code', icon: <CodeOutlined />, label: '解释这段代码的性能瓶颈' },
  { key: 'debug', icon: <BugOutlined />, label: '帮我排查一个线上报错' },
  { key: 'write', icon: <EditOutlined />, label: '写一段产品更新说明' },
];

/**
 * 词槽模式（slotConfig）的助手模板：选中后输入框变成「skill 标签 + 内联填空」，
 * 提交时由 Sender 把填写结果拼成一段完整文本（onSubmit 第一个参数）。
 * 关闭 skill 标签即回到普通自由输入。
 */
type ChatAssistant = {
  key: string;
  label: string;
  icon: ReactNode;
  skill: NonNullable<SenderProps['skill']>;
  slotConfig: NonNullable<SenderProps['slotConfig']>;
};

const CHAT_ASSISTANTS: ChatAssistant[] = [
  {
    key: 'writing',
    label: '写作助手',
    icon: <EditOutlined />,
    skill: { value: 'writing', title: '写作助手' },
    slotConfig: [
      { type: 'text', value: '请帮我写一篇关于' },
      {
        type: 'select',
        key: 'topic',
        props: {
          defaultValue: '校园',
          options: ['校园', '旅行', '阅读'],
          placeholder: '请输入主题',
        },
      },
      { type: 'text', value: '的文章。要求是' },
      {
        type: 'content',
        key: 'words',
        props: { defaultValue: '800', placeholder: '[请输入字数]' },
      },
      { type: 'text', value: '字。' },
    ],
  },
  {
    key: 'code',
    label: '代码助手',
    icon: <CodeOutlined />,
    skill: { value: 'code', title: '代码助手' },
    slotConfig: [
      { type: 'text', value: '请使用' },
      {
        type: 'select',
        key: 'lang',
        props: {
          defaultValue: 'TypeScript',
          options: ['TypeScript', 'Python', 'Java'],
          placeholder: '请选择语言',
        },
      },
      { type: 'text', value: '写一个' },
      {
        type: 'content',
        key: 'target',
        props: { defaultValue: '小游戏', placeholder: '[请输入要写的东西]' },
      },
      { type: 'text', value: '。' },
    ],
  },
  {
    key: 'search',
    label: '深度搜索',
    icon: <SearchOutlined />,
    skill: { value: 'search', title: '深度搜索' },
    slotConfig: [
      { type: 'text', value: '请帮我搜索关于' },
      {
        type: 'select',
        key: 'category',
        props: {
          defaultValue: 'AI',
          options: ['AI', '技术', '娱乐'],
          placeholder: '请选择类别',
        },
      },
      { type: 'text', value: '的新闻，并给出要点总结。' },
    ],
  },
];

/**
 * CodeHighlighter 内部写死 oneLight 主题（暗色下会是一块白底），这里覆写为自定义主题：
 * 颜色全部取 index.css 里的 --lucy-code-* 变量，亮/暗各一套，因此不必随主题切换。
 */
const CODE_THEME: Record<string, CSSProperties> = {
  'pre[class*="language-"]': {
    margin: 0,
    padding: '12px 16px',
    background: 'var(--lucy-code-bg)',
    color: 'var(--lucy-code-text)',
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  'code[class*="language-"]': {
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },
  comment: { color: 'var(--lucy-code-muted)' },
  prolog: { color: 'var(--lucy-code-muted)' },
  doctype: { color: 'var(--lucy-code-muted)' },
  punctuation: { color: 'var(--lucy-code-muted)' },
  keyword: { color: 'var(--lucy-code-keyword)' },
  operator: { color: 'var(--lucy-code-keyword)' },
  builtin: { color: 'var(--lucy-code-number)' },
  boolean: { color: 'var(--lucy-code-number)' },
  number: { color: 'var(--lucy-code-number)' },
  'attr-name': { color: 'var(--lucy-code-number)' },
  string: { color: 'var(--lucy-code-string)' },
  'attr-value': { color: 'var(--lucy-code-string)' },
  function: { color: 'var(--lucy-code-function)' },
  'class-name': { color: 'var(--lucy-code-function)' },
  tag: { color: 'var(--lucy-code-tag)' },
};

const CODE_HIGHLIGHT_PROPS = { style: CODE_THEME };

/**
 * 代码块渲染：块级 code 交给 CodeHighlighter（语法高亮 + 语言标签 + 复制按钮），
 * 行内 code 保持原样。组件与映射表都放在模块级，避免每次渲染产生新引用导致子树重建。
 */
const MarkdownCode: FC<ComponentProps> = ({
  className,
  children,
  block,
  lang,
}) => {
  if (!block || typeof children !== 'string') {
    return <code className={className}>{children}</code>;
  }
  const language = lang ?? className?.match(/language-([\w+#.-]+)/)?.[1] ?? '';
  return (
    <CodeHighlighter
      lang={language}
      highlightProps={CODE_HIGHLIGHT_PROPS}
      // 气泡底色也是灰的，加一道极浅描边 + 圆角把代码块和正文分开
      className="my-1 overflow-hidden rounded-lg border border-solid border-(--ant-color-border-secondary)"
    >
      {children.replace(/\n$/, '')}
    </CodeHighlighter>
  );
};

const MARKDOWN_COMPONENTS = { code: MarkdownCode };

/** 思考折叠块：思考进行中展开并闪烁；完成/历史默认收起，用户可手动切换 */
const ThinkingBlock = ({
  children,
  thinkingActive,
}: Readonly<ThinkProps & { thinkingActive: boolean }>) => {
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
};

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
          <XMarkdown content={thinking} components={MARKDOWN_COMPONENTS} />
        </ThinkingBlock>
      ) : null}
      <XMarkdown content={content} components={MARKDOWN_COMPONENTS} />
      {msg.truncated ? (
        <div className="text-xs text-amber-600">
          ⚠️ 回复被截断（已达长度上限），可重新发送后再试
        </div>
      ) : null}
    </div>
  );
};

const ChatPage = () => {
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
    <PageShell height="fill" bleed>
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
      </Splitter>
    </PageShell>
  );
};

/**
 * # 行内重命名输入
 * 回车确认；失焦（点击外部）取消并恢复原标题。
 * doneRef 防止 Enter 提交后紧接着的 onBlur 又把取消分支执行一遍。
 */
const InlineRenameInput = ({
  defaultValue,
  onConfirm,
  onCancel,
}: Readonly<{
  defaultValue: string;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}>) => {
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
      maxLength={CONVERSATION_TITLE_MAX_LENGTH}
    />
  );
};

const ChatMessagesArea: FC<{ id: string | undefined }> = ({ id }) => {
  const {
    messages,
    streaming,
    isLoading,
    error,
    send,
    stop,
    modelProviderId: conversationModelId,
  } = useChatStream(id);
  const [value, setValue] = useState('');
  const [reasoning, setReasoning] = useState(true);
  const [creating, { setTrue: setCreatingTrue, setFalse: setCreatingFalse }] =
    useBoolean(false);
  const navigate = useNavigate();
  const create = useCreateConversation();
  const listRef = useRef<ComponentRef<typeof Bubble.List>>(null);
  const [atBottom, setAtBottom] = useState(true);

  // 模型选择：只列 LLM 类型（其它类型不能对话）。会话已带默认模型则用它，否则自动选最近配置的一个
  const { models, isLoading: modelsLoading } = useLlmModelProviders();
  const hasModels = models.length > 0;
  const defaultModelId = conversationModelId ?? models[0]?.id;
  // 用户在当前会话内的手动选择。以会话 id 归属，切换会话即失效回落默认——
  // 用赋值而非 effect 同步，避免 set-state-in-effect 的额外渲染
  const [modelOverride, setModelOverride] = useState<{
    conversationId?: string;
    id: string;
  }>();
  const modelProviderId =
    modelOverride && modelOverride.conversationId === id
      ? modelOverride.id
      : defaultModelId;
  const currentModelName = models.find((m) => m.id === modelProviderId)?.name;

  // 词槽模式：选中助手后输入框变成「skill 标签 + 内联填空」，关掉 skill 标签回到自由输入
  const [assistantKey, setAssistantKey] = useState<string | null>(null);
  const assistant = useMemo(
    () => CHAT_ASSISTANTS.find((a) => a.key === assistantKey),
    [assistantKey],
  );
  // 关闭按钮要能回到自由输入，因此 onClose 在渲染处补上；模板本身放在模块级保持引用稳定
  const skill = useMemo(
    () =>
      assistant
        ? {
            ...assistant.skill,
            closable: { onClose: () => setAssistantKey(null) },
          }
        : undefined,
    [assistant],
  );
  const senderRef = useRef<ComponentRef<typeof Sender>>(null);

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
   * 词槽模式下 text 是 Sender 拼好的完整句子，两者形态一致。
   */
  async function handleSubmit(text: string) {
    const content = text.trim();
    // 提交后清空输入：普通模式清受控值，词槽模式由 Sender 内部重置
    senderRef.current?.clear?.();
    setValue('');
    // 空内容 / 无可用模型不发起发送（输入框已禁用，这里是双保险）
    if (!content || !modelProviderId) return;
    if (id) {
      await send(id, content, { reasoning, modelProviderId });
      return;
    }
    setCreatingTrue();
    try {
      const conv = await create.mutateAsync();
      // 让选择跟随新会话，避免导航到新 id 后回落成默认模型
      setModelOverride({ conversationId: conv.id, id: modelProviderId });
      await navigate({ to: '/chat', search: { id: conv.id }, replace: true });
      void send(conv.id, content, { reasoning, modelProviderId });
    } finally {
      setCreatingFalse();
    }
  }

  /** 快捷提问只填入输入框（不直接发送），并聚焦以便继续编辑 */
  function fillPrompt(text: string) {
    setValue(text);
    senderRef.current?.focus?.();
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
    const isNotFound = errorStatusOf(error) === 404;
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
        <div className="relative min-h-0 flex-1 pt-6">
          {/* 左右撑满：消息列跟随面板宽度，仅保留内边距 */}
          <div className="h-full w-full px-6">
            <Bubble.List
              ref={listRef}
              items={items}
              role={roles}
              autoScroll
              onScroll={handleScroll}
              className="h-full pb-4"
              classNames={{ scroll: 'scrollbar-hide' }}
            />
          </div>
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
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-10 px-6">
          <Welcome
            variant="borderless"
            icon={<img src="/favicon.svg" alt="" className="size-14" />}
            title="你好，我是 Lucy"
            description="基于你的知识库回答问题，也可以直接开始一段普通对话。"
          />
          {/* 词槽模式下输入框已有模板，不再给自由提问的快捷入口 */}
          {assistant ? null : (
            <Prompts
              wrap
              items={QUICK_PROMPTS}
              onItemClick={(info) => fillPrompt(String(info.data.label ?? ''))}
            />
          )}
        </div>
      )}
      {!modelsLoading && !hasModels ? (
        <div className="w-full px-6 pb-2">
          <Alert
            type="warning"
            showIcon
            title="尚未配置可用模型"
            description="请先在「模型管理」中添加模型，并在聊天页选择后再开始对话。"
            action={
              <Button
                size="small"
                onClick={() => navigate({ to: '/integration/model-provider' })}
              >
                去配置模型
              </Button>
            }
          />
        </div>
      ) : null}
      {/* pt-2 / pb-8：输入框与消息区、视口下缘都留出呼吸空间，不贴边；宽度撑满面板 */}
      <div className="w-full px-6 pt-2 pb-8">
        <Sender
          ref={senderRef}
          skill={skill}
          slotConfig={assistant?.slotConfig}
          // 词槽模式下 value 不生效（由 Sender 内部维护 slot 内容），交回非受控
          value={assistant ? undefined : value}
          onChange={(next) => {
            if (!assistant) setValue(next);
          }}
          onSubmit={(text) => {
            void handleSubmit(text);
          }}
          // 发送按钮挪进 footer 右侧：与胶囊工具条同一行
          suffix={false}
          footer={(actionNode) => {
            return (
              <Flex justify="space-between" align="center">
                <Flex gap="small" align="center">
                  {/* 助手模板：选中即进入词槽模式，skill 标签上的 × 回到自由输入 */}
                  <Dropdown
                    menu={{
                      items: CHAT_ASSISTANTS.map((a) => ({
                        key: a.key,
                        icon: a.icon,
                        label: a.label,
                      })),
                      selectedKeys: assistant ? [assistant.key] : [],
                      onClick: ({ key }) => setAssistantKey(key),
                    }}
                  >
                    <Sender.Switch
                      value={false}
                      icon={assistant?.icon ?? <AppstoreOutlined />}
                    >
                      {assistant?.label ?? '选择助手'}
                    </Sender.Switch>
                  </Dropdown>
                  {/* 模型：胶囊下拉，显示当前模型 */}
                  <Dropdown
                    disabled={modelsLoading || !hasModels}
                    menu={{
                      items: models.map((m) => ({
                        key: m.id,
                        label: m.name,
                      })),
                      selectedKeys: modelProviderId ? [modelProviderId] : [],
                      onClick: ({ key }) =>
                        setModelOverride({ conversationId: id, id: key }),
                    }}
                  >
                    <Sender.Switch value={false} icon={<RobotOutlined />}>
                      <span className="inline-block max-w-36 truncate align-middle">
                        {modelsLoading
                          ? '模型：加载中…'
                          : `模型：${currentModelName ?? '未选择'}`}
                      </span>
                    </Sender.Switch>
                  </Dropdown>
                  <Sender.Switch
                    value={reasoning}
                    checkedChildren={
                      <>
                        深度思考：
                        <span className="inline-flex w-7 justify-center">
                          开启
                        </span>
                      </>
                    }
                    unCheckedChildren={
                      <>
                        深度思考：
                        <span className="inline-flex w-7 justify-center">
                          关闭
                        </span>
                      </>
                    }
                    onChange={setReasoning}
                    icon={<OpenAIOutlined />}
                  />
                </Flex>
                <Flex align="center">
                  {/* 用定高细线而非 antd Divider：后者是 inline-block + 相对定位 + em 高度，
                      在 Flex 行里既不与发送按钮同高，也做不到垂直居中 */}
                  <span
                    aria-hidden
                    className="mx-1 h-5 w-px shrink-0 bg-(--ant-color-border)"
                  />
                  {actionNode}
                </Flex>
              </Flex>
            );
          }}
          loading={streaming ?? creating}
          onCancel={stop}
          disabled={modelsLoading || !hasModels}
          placeholder={
            modelsLoading
              ? '正在加载模型…'
              : hasModels
                ? '输入消息，Enter 发送'
                : '请先配置模型'
          }
        />
      </div>
    </Flex>
  );
};

export const Route = createFileRoute('/_layout/chat')({
  // /chat?id=<conversationId>：可选 id，缺省时首条消息无感创建会话
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: ChatPage,
});
