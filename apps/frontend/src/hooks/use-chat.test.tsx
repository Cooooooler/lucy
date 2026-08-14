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

vi.mock('./use-ai', () => ({ useConversation: mocks.useConversation }));
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
  role: 'assistant',
  data: { content },
});
const done = (): AiStreamEvent => ({
  type: 'done',
  requestId,
  role: 'assistant',
  data: { finish_reason: 'stop' },
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
      { id: 'm2', role: 'assistant', content: 'hi', status: 'complete' },
    ]);
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({
      key: 'm1',
      role: 'user',
      content: '你好',
    });
    expect(result.current.messages[1]).toMatchObject({
      key: 'm2',
      role: 'assistant',
      content: 'hi',
    });
  });

  it('send 追加 user/assistant 并消费 delta 累积内容，done 结束', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([delta('你'), delta('好'), done()])),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(mocks.createStreamRequest).toHaveBeenCalledWith('c1', {
      content: 'hi',
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: '你好',
      streaming: false,
    });
    expect(result.current.streaming).toBe(false);
  });

  it('error 事件置 error 并结束流式', async () => {
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => streamOf([errorEvent(50002, '模型调用超时')])),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '模型调用超时',
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
      await result.current.send('hi');
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
      promise = result.current.send('hi');
    });
    await waitFor(() =>
      expect(result.current.messages[1]?.content).toBe('半截'),
    );
    act(() => result.current.stop());
    expect(abort).toHaveBeenCalled();
    await promise;
  });

  it('streaming 中再次 send 被忽略', async () => {
    async function* pendingGen() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { result: done() };
    }
    mocks.createStreamRequest.mockReturnValue(
      mockStreamRequest(() => pendingGen()),
    );
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    let promise!: Promise<void>;
    act(() => {
      promise = result.current.send('第一句');
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));
    const length = result.current.messages.length;
    await result.current.send('第二句');
    expect(result.current.messages.length).toBe(length);
    await promise;
  });
});
