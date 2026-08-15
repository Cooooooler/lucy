import type { AiStreamEvent } from '@lucy/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationApi,
  createStreamRequest,
  deleteConversationApi,
  getConversationApi,
  listConversationsApi,
  renameConversationApi,
  streamSendMessageApi,
} from './ai';
import type { Conversation } from './types';

const mocks = vi.hoisted(() => ({ refreshTokens: vi.fn() }));

// 保留真实 http（走真实 fetch 与完整插件链），仅覆盖 refreshTokens 以便断言流式 401 不触发刷新
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
    messages: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// SSE 帧构造：OpenAI 风格 `data: <json>`，流末尾 `data: [DONE]`
const requestId = 'req-1';
const frame = (event: Record<string, unknown>) =>
  `data: ${JSON.stringify(event)}\n\n`;
const deltaFrame = (content: string) =>
  frame({ type: 'delta', requestId, role: 'ai', data: { content } });
const doneFrame = frame({
  type: 'done',
  requestId,
  role: 'ai',
  data: { finish_reason: 'stop' },
});
const errorFrame = (code: number, message: string) =>
  frame({ type: 'error', requestId, data: { code, message } });
const DONE = 'data: [DONE]\n\n';

// streamSendMessageApi 返回事件流，chunk.result 为解析后的 AiStreamEvent
async function collect(
  stream: ReturnType<typeof streamSendMessageApi>,
): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const chunk of stream) {
    if (chunk.result) events.push(chunk.result);
  }
  return events;
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
        '/api/ai/conversations',
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
        '/api/ai/conversations?page=2&pageSize=10',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(data);
    });

    it('getConversationApi 调用 GET 详情', async () => {
      const conv = makeConversation();
      fetchMock.mockResolvedValueOnce(okEnvelope(conv));
      await expect(getConversationApi('c1')).resolves.toEqual(conv);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ai/conversations/c1',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('renameConversationApi 调用 PATCH', async () => {
      const conv = makeConversation({ title: '新标题' });
      fetchMock.mockResolvedValueOnce(okEnvelope(conv));
      const result = await renameConversationApi('c1', { title: '新标题' });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/ai/conversations/c1',
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
        '/api/ai/conversations/c1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('streamSendMessageApi', () => {
    it('解析 SSE 帧为事件流：delta/done 逐条产出，[DONE] 终止', async () => {
      const body = deltaFrame('你') + deltaFrame('好') + doneFrame + DONE;
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
      const events = await collect(
        streamSendMessageApi('c1', { content: 'hi' }),
      );
      expect(events).toEqual([
        {
          type: 'delta',
          requestId,
          role: 'ai',
          data: { content: '你' },
        },
        {
          type: 'delta',
          requestId,
          role: 'ai',
          data: { content: '好' },
        },
        {
          type: 'done',
          requestId,
          role: 'ai',
          data: { finish_reason: 'stop' },
        },
      ]);
    });

    it('内容含换行经 JSON 转义后不丢失', async () => {
      const body = deltaFrame('第一行\n第二行') + doneFrame + DONE;
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
      const events = await collect(
        streamSendMessageApi('c1', { content: 'hi' }),
      );
      expect(events[0]).toMatchObject({
        type: 'delta',
        data: { content: '第一行\n第二行' },
      });
    });

    it('请求带 Bearer 与 JSON body', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(doneFrame + DONE, { status: 200 }),
      );
      await collect(
        streamSendMessageApi('c1', { content: 'hi', model: 'qwen' }),
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/ai/conversations/c1/messages');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'Bearer test-token',
      );
      expect(init.body).toBe(JSON.stringify({ content: 'hi', model: 'qwen' }));
    });

    it('error 事件作为事件流产出而非抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(errorFrame(50002, '模型调用超时') + DONE, { status: 200 }),
      );
      const events = await collect(
        streamSendMessageApi('c1', { content: 'hi' }),
      );
      expect(events[0]).toEqual({
        type: 'error',
        requestId,
        data: { code: 50002, message: '模型调用超时' },
      });
    });

    it('非 2xx 抛 ApiError', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
      const gen = streamSendMessageApi('c1', { content: 'hi' });
      await expect(collect(gen)).rejects.toMatchObject({
        name: 'ApiError',
        message: '请求失败（500）',
      });
    });

    it('401 不自动刷新令牌（skipAuthRefresh 跳过重放）', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      const gen = streamSendMessageApi('c1', { content: 'hi' });
      await expect(collect(gen)).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
      });
      expect(mocks.refreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('createStreamRequest', () => {
    it('返回带 stream/abort 的请求对象并发出 POST', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(doneFrame + DONE, { status: 200 }),
      );
      const req = createStreamRequest('c1', { content: 'hi' });
      expect(typeof req.stream).toBe('function');
      expect(typeof req.abort).toBe('function');
      // hook-fetch 在请求创建后异步发起 fetch，需先消费流（fetch 必然已发出）再断言请求详情
      const events = await collect(req.stream());
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/ai/conversations/c1/messages');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ content: 'hi' }));
      expect(events[events.length - 1]?.type).toBe('done');
    });
  });
});
