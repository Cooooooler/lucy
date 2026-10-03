import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createModelProviderApi,
  deleteModelProviderApi,
  getModelProviderApi,
  listModelProvidersApi,
  testModelProviderConnectionApi,
  updateModelProviderApi,
} from './model-provider.js';
import type { ModelProvider } from './types.js';

// 保留真实 http（走真实 fetch 与完整插件链），仅覆盖 authStore 以便注入 Bearer
vi.mock('../stores/auth', () => ({
  authStore: { get: () => ({ accessToken: 'test-token' }) },
  applyTokens: vi.fn(),
  handleSessionExpired: vi.fn(),
}));

const fetchMock = vi.fn();

const okEnvelope = (data: unknown) =>
  new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
  });

function makeModel(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'm1',
    ownerId: 'u1',
    name: 'gpt-4o-mini',
    type: 'llm',
    vendor: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chat-completions',
    contextLength: 128000,
    apiKeyMasked: '••••••abcd',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('api/model-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createModelProviderApi 调用 POST /model-providers', async () => {
    const model = makeModel();
    fetchMock.mockResolvedValueOnce(okEnvelope(model));
    const created = await createModelProviderApi({
      name: 'gpt-4o-mini',
      type: 'llm',
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      contextLength: 128000,
      apiKey: 'sk-secret',
    });
    expect(created).toEqual(model);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'gpt-4o-mini',
          type: 'llm',
          vendor: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          contextLength: 128000,
          apiKey: 'sk-secret',
        }),
      }),
    );
  });

  it('listModelProvidersApi 携带游标/每页条数/过滤参数', async () => {
    const data = { list: [makeModel()], nextCursor: 'next-cursor' };
    fetchMock.mockResolvedValueOnce(okEnvelope(data));
    const result = await listModelProvidersApi({
      limit: 10,
      cursor: 'abc',
      type: 'llm',
      name: 'gpt',
    });
    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers?limit=10&cursor=abc&type=llm&name=gpt',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getModelProviderApi 调用 GET 详情', async () => {
    const model = makeModel();
    fetchMock.mockResolvedValueOnce(okEnvelope(model));
    await expect(getModelProviderApi('m1')).resolves.toEqual(model);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers/m1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('updateModelProviderApi 调用 PATCH', async () => {
    const model = makeModel({ name: '新名称' });
    fetchMock.mockResolvedValueOnce(okEnvelope(model));
    const result = await updateModelProviderApi('m1', { name: '新名称' });
    expect(result).toEqual(model);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers/m1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: '新名称' }),
      }),
    );
  });

  it('deleteModelProviderApi 调用 DELETE', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(null));
    await expect(deleteModelProviderApi('m1')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers/m1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('testModelProviderConnectionApi 调用 POST test-connection', async () => {
    const result = {
      ok: true,
      message: '连接成功',
      latencyMs: 120,
      detail: '回复：你好',
    };
    fetchMock.mockResolvedValueOnce(okEnvelope(result));
    await expect(testModelProviderConnectionApi('m1')).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/model-providers/m1/test-connection',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
