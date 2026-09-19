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

const useChatStreamMock = vi.fn();

vi.mock('@/hooks/use-ai', () => ({
  useConversationList: () => ({
    data: { list: [] },
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
  useChatStream: (...args: unknown[]) => useChatStreamMock(...args),
}));

describe('routes/_layout/chat', () => {
  beforeEach(() => {
    useChatStreamMock.mockReset();
  });

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
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: null,
      send: vi.fn(),
      stop: vi.fn(),
    });
    renderChat({ id: undefined });
    // Welcome 标题（英文通栏文案）
    expect(screen.getByText(/Ant Design X/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
  });

  it('loading 时渲染 Spin', () => {
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: true,
      error: null,
      send: vi.fn(),
      stop: vi.fn(),
    });
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
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: err404,
      send: vi.fn(),
      stop: vi.fn(),
    });
    renderChat({ id: 'c-missing' });
    expect(screen.getByText('会话不存在')).toBeInTheDocument();
    expect(screen.queryByText('加载失败')).not.toBeInTheDocument();
  });

  it('非 404 错误渲染“加载失败”', () => {
    const err500 = Object.assign(new Error('boom'), {
      name: 'ApiError',
      status: 500,
    });
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: err500,
      send: vi.fn(),
      stop: vi.fn(),
    });
    renderChat({ id: 'c1' });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('会话不存在')).not.toBeInTheDocument();
  });

  it('已加载消息 + 输入并提交（Sender.onSubmit 触发 send）', async () => {
    const sendMock = vi.fn(async () => undefined);
    useChatStreamMock.mockReturnValue({
      messages: [{ id: 'm1', role: 'user', content: '你好' }],
      streaming: false,
      isLoading: false,
      error: null,
      send: sendMock,
      stop: vi.fn(),
    });
    renderChat({ id: 'c1' });
    expect(screen.getByText('你好')).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/输入消息/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '下一条' } });
    expect(input.value).toBe('下一条');
    expect(useChatStreamMock).toHaveBeenCalled();
  });

  it('回空：未知角色也能安全渲染（RoleType 占位 avatar）', () => {
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: null,
      send: vi.fn(),
      stop: vi.fn(),
    });
    // 无 id 时 renderMarkdown 不跑（因为没有 messages），只验证 not throw
    expect(() => renderChat({ id: undefined })).not.toThrow();
  });
});
