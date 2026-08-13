import type { Conversation } from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useConversation,
  useConversationList,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
  useSendMessage,
} from './use-ai';

const api = vi.hoisted(() => ({
  createConversationApi: vi.fn(),
  listConversationsApi: vi.fn(),
  getConversationApi: vi.fn(),
  renameConversationApi: vi.fn(),
  deleteConversationApi: vi.fn(),
  streamSendMessageApi: vi.fn(),
}));

vi.mock('@/api/ai', () => api);

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    userId: '1',
    title: null,
    model: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useConversationList', () => {
  it('加载会话列表', async () => {
    const data = {
      list: [makeConversation()],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    api.listConversationsApi.mockResolvedValue(data);
    const { result } = renderHook(() => useConversationList(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listConversationsApi).toHaveBeenCalledWith(1, 20);
    expect(result.current.data).toEqual(data);
  });
});

describe('useConversation', () => {
  it('id 为空时禁用请求', () => {
    const { result } = renderHook(() => useConversation(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.getConversationApi).not.toHaveBeenCalled();
  });

  it('加载会话详情', async () => {
    const conv = makeConversation({ messages: [] });
    api.getConversationApi.mockResolvedValue(conv);
    const { result } = renderHook(() => useConversation('c1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(conv);
  });
});

describe('useCreateConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('创建后使列表查询失效并重新请求', async () => {
    const created = makeConversation();
    api.createConversationApi.mockResolvedValue(created);
    api.listConversationsApi.mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    const wrapper = createWrapper();
    const list = renderHook(() => useConversationList(), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(api.listConversationsApi).toHaveBeenCalledTimes(1);

    const mutation = renderHook(() => useCreateConversation(), { wrapper });
    await act(async () => {
      await mutation.result.current.mutateAsync({ model: 'qwen' });
    });

    expect(api.createConversationApi).toHaveBeenCalledWith({ model: 'qwen' });
    await waitFor(() => expect(mutation.result.current.data).toEqual(created));
    await waitFor(() =>
      expect(api.listConversationsApi).toHaveBeenCalledTimes(2),
    );
  });
});

describe('useRenameConversation', () => {
  it('改名并返回更新后会话', async () => {
    const updated = makeConversation({ title: '新标题' });
    api.renameConversationApi.mockResolvedValue(updated);
    const { result } = renderHook(() => useRenameConversation(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: 'c1', title: '新标题' });
    });
    expect(api.renameConversationApi).toHaveBeenCalledWith('c1', {
      title: '新标题',
    });
    await waitFor(() => expect(result.current.data).toEqual(updated));
  });
});

describe('useDeleteConversation', () => {
  it('删除会话并移除详情缓存', async () => {
    api.deleteConversationApi.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useDeleteConversation(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync('c1');
    });
    expect(api.deleteConversationApi).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(result.current.data).toEqual({ success: true }));
  });
});

describe('useSendMessage', () => {
  it('透传 onDelta 并返回完整回复', async () => {
    api.streamSendMessageApi.mockImplementation(
      async (_id, _input, onDelta) => {
        onDelta?.('你');
        onDelta?.('好');
        return '你好';
      },
    );
    const deltas: string[] = [];
    const { result } = renderHook(() => useSendMessage(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({
        conversationId: 'c1',
        input: { content: 'hi' },
        onDelta: (t) => deltas.push(t),
      });
    });
    expect(deltas).toEqual(['你', '好']);
    await waitFor(() => expect(result.current.data).toBe('你好'));
    expect(api.streamSendMessageApi).toHaveBeenCalledWith(
      'c1',
      { content: 'hi' },
      expect.any(Function),
      undefined,
    );
  });
});
