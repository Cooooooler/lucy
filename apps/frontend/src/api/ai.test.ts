import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationApi,
  deleteConversationApi,
  getConversationApi,
  listConversationsApi,
  renameConversationApi,
  streamSendMessageApi,
} from './ai';
import type { Conversation } from './types';

const mocks = vi.hoisted(() => ({ refreshTokens: vi.fn() }));

// 保留真实 http（走真实 fetch 与完整插件链），仅覆盖 refreshTokens 以便测 401 重试
vi.mock('./client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./client')>();
  return { ...mod, refreshTokens: mocks.refreshTokens };
});

vi.mock('../stores/auth', () => ({
  authStore: { get: () => ({ accessToken: 'test-token' }) },
}));

const fetchMock = vi.fn();

const okEnvelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
  });

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

describe('api/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshTokens.mockResolvedValue(undefined);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('CRUD', () => {
    it('createConversationApi 调用 POST /ai/conversations', async () => {
      const conv = makeConversation();
      fetchMock.mockResolvedValueOnce(okEnvelope(conv));
      const result = await createConversationApi({ model: 'qwen' });
      expect(fetchMock).toHaveBeenCalledWith(
        '/ai/conversations',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ model: 'qwen' }),
        }),
      );
      expect(result).toEqual(conv);
    });

    it('listConversationsApi 携带分页参数', async () => {
      const data = {
        list: [makeConversation()],
        total: 1,
        page: 2,
        pageSize: 10,
      };
      fetchMock.mockResolvedValueOnce(okEnvelope(data));
      const result = await listConversationsApi(2, 10);
      expect(fetchMock).toHaveBeenCalledWith(
        '/ai/conversations?page=2&pageSize=10',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(data);
    });

    it('getConversationApi 调用 GET 详情', async () => {
      const conv = makeConversation();
      fetchMock.mockResolvedValueOnce(okEnvelope(conv));
      await expect(getConversationApi('c1')).resolves.toEqual(conv);
      expect(fetchMock).toHaveBeenCalledWith(
        '/ai/conversations/c1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('renameConversationApi 调用 PATCH', async () => {
      const conv = makeConversation({ title: '新标题' });
      fetchMock.mockResolvedValueOnce(okEnvelope(conv));
      const result = await renameConversationApi('c1', { title: '新标题' });
      expect(fetchMock).toHaveBeenCalledWith(
        '/ai/conversations/c1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: '新标题' }),
        }),
      );
      expect(result).toEqual(conv);
    });

    it('deleteConversationApi 调用 DELETE', async () => {
      fetchMock.mockResolvedValueOnce(okEnvelope({ success: true }));
      await expect(deleteConversationApi('c1')).resolves.toEqual({
        success: true,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/ai/conversations/c1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('streamSendMessageApi', () => {
    it('解析 delta 帧累积全文，done 结束', async () => {
      const body =
        'event: delta\ndata: 你\n\nevent: delta\ndata: 好\n\nevent: done\n\n';
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
      const deltas: string[] = [];
      const result = await streamSendMessageApi('c1', { content: 'hi' }, (t) =>
        deltas.push(t),
      );
      expect(deltas).toEqual(['你', '好']);
      expect(result).toBe('你好');
    });

    it('多行 data 用换行拼接，不丢失内容', async () => {
      const body =
        'event: delta\ndata: 第一行\ndata: 第二行\n\nevent: done\n\n';
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
      await expect(streamSendMessageApi('c1', { content: 'hi' })).resolves.toBe(
        '第一行\n第二行',
      );
    });

    it('请求带 Bearer 与 JSON body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('event: done\n\n', { status: 200 }),
      );
      await streamSendMessageApi('c1', { content: 'hi', model: 'qwen' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/ai/conversations/c1/messages');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'Bearer test-token',
      );
      expect(init.body).toBe(JSON.stringify({ content: 'hi', model: 'qwen' }));
    });

    it('收到 error 事件抛出 ApiError', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('event: error\ndata: 生成失败\n\n', { status: 200 }),
      );
      await expect(
        streamSendMessageApi('c1', { content: 'hi' }),
      ).rejects.toThrow('生成失败');
    });

    it('401 时刷新令牌并重试一次', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 401 }))
        .mockResolvedValueOnce(
          new Response('event: done\n\n', { status: 200 }),
        );
      await expect(streamSendMessageApi('c1', { content: 'hi' })).resolves.toBe(
        '',
      );
      expect(mocks.refreshTokens).toHaveBeenCalledTimes(1);
    });

    it('非 2xx 抛出 ApiError', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
      await expect(
        streamSendMessageApi('c1', { content: 'hi' }),
      ).rejects.toThrow('请求失败（500）');
    });

    it('signal 中止时取消请求', async () => {
      const controller = new AbortController();
      fetchMock.mockImplementation((_url, init) => {
        const stream = new ReadableStream({
          start(streamController) {
            streamController.enqueue(
              new TextEncoder().encode('event: delta\ndata: 你\n\n'),
            );
            init.signal.addEventListener('abort', () => {
              streamController.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      });

      const promise = streamSendMessageApi(
        'c1',
        { content: 'hi' },
        undefined,
        controller.signal,
      );
      // 等 fetch 启动、流建立后再中止，模拟生成中点击停止
      await new Promise((r) => setTimeout(r, 0));
      controller.abort();

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});
