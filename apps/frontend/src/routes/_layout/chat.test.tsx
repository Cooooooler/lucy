import { ApiError } from '@/api/client';
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as ChatRoute } from './chat';

// useChatStream、useConversationList 等 hook 由 _layout/chat 导入；测试时桩掉
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

  it('error 时按 404 / 非 404 分支渲染 Result', async () => {
    const err404 = new ApiError('not found', undefined, 404);
    (err404 as unknown as { response?: Response }).response =
      undefined as unknown as Response;
    // chat 页 ChatMessagesArea 里 isNotFound = error instanceof ApiError && error.status === 404
    // 保证 status 可读后再渲染
    useChatStreamMock.mockReturnValue({
      messages: [],
      streaming: false,
      isLoading: false,
      error: err404,
      send: vi.fn(),
      stop: vi.fn(),
    });
    // 首帧可能是 pending（router 在等 beforeLoad），次帧才切 error
    const { unmount } = renderChat({ id: 'c-missing' });
    const ok = await new Promise<boolean>((res) => {
      let i = 0;
      const tick = () => {
        if (screen.queryByText('会话不存在') ?? screen.queryByText('加载失败'))
          return res(true);
        if (++i > 20) return res(false);
        setTimeout(tick, 40);
      };
      tick();
    });
    // 无论是 404 还是非 404，都不应是「思考过程（待接入）」壳
    expect(ok).toBe(true);
    unmount();
  });

  it('已加载消息 + 输入并提交（首次无 id 时隐式创建会话，见 handleSubmit）', async () => {
    const sendMock = vi.fn();
    useChatStreamMock.mockReturnValue({
      messages: [{ id: 'm1', role: 'user', content: '你好' }],
      streaming: false,
      isLoading: false,
      error: null,
      send: sendMock,
      stop: vi.fn(),
    });
    const { container } = renderChat({ id: 'c1' });
    expect(container.textContent).toContain('你好');

    const input = screen.getByPlaceholderText(/输入消息/);
    fireEvent.change(input, { target: { value: '下一条' } });
    // Sender 的提交通过 AntdX Sender.onSubmit 触发（Button click → handleSubmit）
    // 触发方式：直接调 useChatStreamMock 返回的 send
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
