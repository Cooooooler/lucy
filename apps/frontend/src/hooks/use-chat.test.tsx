import type { AiStreamEvent } from '@lucy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStream } from './use-chat';

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  createStreamRequest: vi.fn(),
}));

vi.mock('./use-ai', () => ({
  useConversation: mocks.useConversation,
  conversationListAll: ['ai', 'conversations', 'list'],
}));
vi.mock('@/api/ai', () => ({ createStreamRequest: mocks.createStreamRequest }));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const requestId = 'r1';
const delta = (content: string): AiStreamEvent => ({
  type: 'delta',
  requestId,
  role: 'ai',
  data: { content },
});
const deltaThinking = (thinking: string): AiStreamEvent => ({
  type: 'delta',
  requestId,
  role: 'ai',
  data: { thinking },
});
const done = (): AiStreamEvent => ({
  type: 'done',
  requestId,
  role: 'ai',
  data: { finish_reason: 'stop' },
});
const doneTruncated = (): AiStreamEvent => ({
  type: 'done',
  requestId,
  role: 'ai',
  data: { finish_reason: 'length', truncated: true },
});
const errorEvent = (code: number, message: string): AiStreamEvent => ({
  type: 'error',
  requestId,
  data: { code, message },
});

async function* streamOf(events: AiStreamEvent[]) {
  for (const e of events) yield { result: e };
}

// mock 的 request 对象须补齐 finally/catch no-op：hook-fetch 的 useHookFetch 是真实实现，
// 其内部 send() 会调用 request 对象自带的 finally/catch（真实 Request 对象具备），
// 纯 { stream, abort } 对象会因缺少这两个方法在 send 时同步抛错。
function mockStreamRequest(
  stream: () => AsyncGenerator<unknown>,
  abort: () => void = vi.fn(),
) {
  return { stream, abort, finally: vi.fn(), catch: vi.fn() };
}

function mockConversation(messages: unknown[] = []) {
  mocks.useConversation.mockReturnValue({
    data: { id: 'c1', messages },
    isLoading: false,
    error: null,
  });
}

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversation([]);
  });

  it('历史消息初始化映射为消息列表', async () => {
    mockConversation([
      { id: 'm1', role: 'user', content: '你好', status: null },
      { id: 'm2', role: 'ai', content: 'hi', status: 'complete' },
      { id: 'm3', role: 'ai', content: '半截', status: 'aborted' },
      { id: 'm4', role: 'ai', content: '', status: 'failed' },
    ]);
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(4));
    expect(result.current.messages[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      content: '你好',
    });
    expect(result.current.messages[1]).toMatchObject({
      id: 'm2',
      role: 'ai',
      content: 'hi',
    });
    expect(result.current.messages[2]).toMatchObject({
      id: 'm3',
      role: 'ai',
      content: '半截',
      error: '生成中断',
    });
    expect(result.current.messages[3]).toMatchObject({
      id: 'm4',
      role: 'ai',
      content: '',
      error: '生成失败',
    });
  });

  it('历史消息携带 truncated:true → 映射到 ChatMessage.truncated（重开后仍识别截断）', async () => {
    mockConversation([
      {
        id: 'm1',
        role: 'ai',
        content: '半截',
        status: 'complete',
        truncated: true,
      },
      {
        id: 'm2',
        role: 'ai',
        content: '完整',
        status: 'complete',
        truncated: false,
      },
    ]);
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({
      role: 'ai',
      content: '半截',
      truncated: true,
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'ai',
      content: '完整',
      truncated: false,
    });
  });

  it('send 追加 user/ai 并消费 delta 累积内容，done 结束', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([delta('你'), delta('好'), done()])),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(mocks.createStreamRequest).toHaveBeenCalledWith('c1', {
      content: 'hi',
      reasoning: false,
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'ai',
      content: '你好',
      streaming: false,
    });
    expect(result.current.streaming).toBe(false);
  });

  it('done 标记 truncated：message 置位 truncated 且结束流式', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() =>
        streamOf([delta('先'), delta('试着'), doneTruncated()]),
      ),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'ai',
      content: '先试着',
      streaming: false,
      truncated: true,
    });
  });

  it('thinking 帧累积到 message.thinking，content 只累积回答', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() =>
        streamOf([deltaThinking('先思考'), delta('回答'), done()]),
      ),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    const ai = result.current.messages.find((m) => m.role === 'ai');
    expect(ai).toMatchObject({ thinking: '先思考', content: '回答' });
  });

  it('error 事件按错误码映射文案并暴露 errorCode，结束流式', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([errorEvent(50002, '模型调用超时')])),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '模型响应超时，请稍后重试',
      errorCode: 50002,
    });
  });

  it('未知错误码回退到后端 message', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([errorEvent(59999, '未知错误')])),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '未知错误',
      errorCode: 59999,
    });
  });

  it('流抛错时置生成中断', async () => {
    // 生成器在首次迭代即抛错，模拟流式中途异常；require-yield 对无 yield 的生成器误报
    // eslint-disable-next-line require-yield
    async function* broken() {
      throw new Error('boom');
    }
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => broken()),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '生成中断',
    });
  });

  it('stop 中止当前流（调用 Request.abort）', async () => {
    const abort = vi.fn();
    async function* pendingGen() {
      yield { result: delta('半截') };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => pendingGen(), abort),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.send('c1', 'hi');
    });
    await waitFor(() =>
      expect(result.current.messages[1]?.content).toBe('半截'),
    );
    act(() => result.current.stop());
    expect(abort).toHaveBeenCalled();
    await promise;
  });

  it('新会话：晚到的空历史不覆盖已 push 的乐观消息', async () => {
    // 无感创建：id 刚生成、后端历史尚为空，send 已在本地 push 乐观消息；
    // 历史查询晚到且为空时不得 setMessages([])，否则正在流式的 ai 气泡会被清空
    mocks.useConversation.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([delta('你'), delta('好'), done()])),
    );
    const { result, rerender } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('c1', 'hi');
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hi',
    });

    // 空历史晚到 → 不注入，乐观消息保留（流式内容也不丢失）
    mocks.useConversation.mockReturnValue({
      data: { id: 'c1', messages: [] },
      isLoading: false,
      error: null,
    });
    rerender();
    await waitFor(() => {});
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'ai',
      content: '你好',
    });
  });

  it('无会话 id 时 send 为空操作', async () => {
    mocks.useConversation.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([delta('你')])),
    );
    const { result } = renderHook(() => useChatStream(undefined), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send(undefined, 'hi');
    });
    expect(mocks.createStreamRequest).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.streaming).toBe(false);
  });

  it('会话 id 变化时重置消息并重新注入新历史', async () => {
    mocks.useConversation.mockReturnValue({
      data: {
        id: 'c1',
        messages: [{ id: 'm1', role: 'user', content: '旧会话', status: null }],
      },
      isLoading: false,
      error: null,
    });
    const { result, rerender } = renderHook(
      ({ cid }: { cid: string }) => useChatStream(cid),
      { initialProps: { cid: 'c1' }, wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ content: '旧会话' });

    // 切换到 c2：重置旧消息后注入 c2 历史
    mocks.useConversation.mockReturnValue({
      data: {
        id: 'c2',
        messages: [{ id: 'm2', role: 'user', content: '新会话', status: null }],
      },
      isLoading: false,
      error: null,
    });
    rerender({ cid: 'c2' });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({
      id: 'm2',
      content: '新会话',
    });
  });
});
