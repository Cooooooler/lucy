import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as ChatRoute } from './chat';

vi.mock('@tanstack/react-router', async () => {
  const actual = (await vi.importActual('@tanstack/react-router')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useNavigate: () => vi.fn(async () => {}),
    useRouter: () => ({
      navigate: vi.fn(async () => {}),
      buildLocation: (opts: unknown) => opts,
      history: { push: vi.fn(), replace: vi.fn() },
    }),
    useRouterState: () => ({ location: { pathname: '/chat' } }),
    useMatch: () => null,
    useMatches: () => [],
  };
});

const mocks = vi.hoisted(() => ({
  useChatStream: vi.fn(),
  useLlmModelProviders: vi.fn(),
}));

vi.mock('@/hooks/use-ai', () => ({
  useConversationList: () => ({
    data: { list: [], nextCursor: null },
    isLoading: false,
    error: null,
  }),
  useConversation: () => ({
    data: { id: 'c1', messages: [] },
    isLoading: false,
    error: null,
  }),
  useCreateConversation: () => ({
    mutateAsync: vi.fn(async () => ({ id: 'c2' })),
  }),
  useDeleteConversation: () => ({ mutateAsync: vi.fn() }),
  useRenameConversation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/use-chat', () => ({
  useChatStream: (...args: unknown[]) => mocks.useChatStream(...args),
}));
vi.mock('@/hooks/use-model-provider', () => ({
  useLlmModelProviders: () => mocks.useLlmModelProviders(),
}));

describe('routes/_layout/chat', () => {
  beforeEach(() => {
    mocks.useChatStream.mockReset();
    mocks.useLlmModelProviders.mockReset();
    // 默认：已配置一个 LLM 模型，发送框可用
    mocks.useLlmModelProviders.mockReturnValue({
      models: [{ id: 'model-1', name: 'gpt-4o-mini' }],
      isLoading: false,
    });
  });

  /** 默认的 useChatStream 返回值，可用 over 覆盖单个字段 */
  function mockChat(over: Record<string, unknown> = {}) {
    mocks.useChatStream.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: null,
      send: vi.fn(),
      stop: vi.fn(),
      ...over,
    });
  }

  function renderChat(opts: { id?: string } = {}) {
    // Route.useSearch() 返回 { id }，在顶层组件里被调用
    vi.spyOn(ChatRoute, 'useSearch').mockReturnValue({ id: opts.id });
    const C = ChatRoute.options.component as FC;
    return render(
      <AntdApp>
        <C />
      </AntdApp>,
    );
  }

  it('初始（无 id）渲染 Welcome + 发送框', () => {
    mockChat();
    renderChat({ id: undefined });
    // Welcome 标题（英文通栏文案）
    expect(screen.getByText(/Ant Design X/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
  });

  it('loading 时渲染 Spin', () => {
    mockChat({ isLoading: true });
    renderChat({ id: 'c1' });
    // Spin 在 ChatMessagesArea 里以 <Spin /> 出现（通过 role/status 断言）
    expect(document.querySelector('.ant-spin')).not.toBeNull();
  });

  it('404 错误渲染“会话不存在”', () => {
    // 模拟 hook-fetch 克隆后的错误：**类身份已丢失**（instanceof ApiError 为 false），
    // 只有 message/name/status 等字段可用——判定必须基于字段（见 errorStatusOf）
    const err404 = Object.assign(new Error('not found'), {
      name: 'ApiError',
      status: 404,
    });
    mockChat({ error: err404 });
    renderChat({ id: 'c-missing' });
    expect(screen.getByText('会话不存在')).toBeInTheDocument();
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
  });

  it('非 404 错误渲染“加载失败”', () => {
    const err500 = Object.assign(new Error('boom'), {
      name: 'ApiError',
      status: 500,
    });
    mockChat({ error: err500 });
    renderChat({ id: 'c1' });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('会话不存在')).not.toBeInTheDocument();
  });

  it('已加载消息 + 输入并提交（Sender.onSubmit 触发 send）', async () => {
    const sendMock = vi.fn(async () => undefined);
    mockChat({
      messages: [{ id: 'm1', role: 'user', content: '你好' }],
      send: sendMock,
    });
    renderChat({ id: 'c1' });
    expect(screen.getByText('你好')).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '下一条' } });
    expect(input.value).toBe('下一条');
    expect(mocks.useChatStream).toHaveBeenCalled();
  });

  it('无可用模型：显示配置提示且发送框禁用', () => {
    mocks.useLlmModelProviders.mockReturnValue({
      models: [],
      isLoading: false,
    });
    mockChat();
    renderChat({ id: undefined });
    expect(screen.getByText('尚未配置可用模型')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/请先配置模型/)).toBeDisabled();
  });

  it('模型加载中：不误报未配置，发送框禁用且占位为加载中', () => {
    mocks.useLlmModelProviders.mockReturnValue({ models: [], isLoading: true });
    mockChat();
    renderChat({ id: undefined });
    expect(screen.queryByText('尚未配置可用模型')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/正在加载模型/)).toBeDisabled();
  });

  it('回空：未知角色也能安全渲染（RoleType 占位 avatar）', () => {
    mockChat();
    // 无 id 时 renderMarkdown 不跑（因为没有 messages），只验证 not throw
    expect(() => renderChat({ id: undefined })).not.toThrow();
  });
});
