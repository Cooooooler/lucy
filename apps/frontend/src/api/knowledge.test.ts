import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDocumentApi,
  createKnowledgeBaseApi,
  deleteDocumentApi,
  deleteKnowledgeBaseApi,
  getDocumentApi,
  getKnowledgeBaseApi,
  listDocumentsApi,
  listKnowledgeBasesApi,
  updateKnowledgeBaseApi,
} from './knowledge';
import type { KnowledgeBase, KnowledgeDocument } from './types';

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

function makeKnowledgeBase(
  overrides: Partial<KnowledgeBase> = {},
): KnowledgeBase {
  return {
    id: 'kb1',
    ownerId: 'u1',
    visibility: 'private',
    name: '产品文档',
    description: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument {
  return {
    id: 'd1',
    knowledgeBaseId: 'kb1',
    fileId: 'f1',
    title: 'intro',
    content: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('api/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createKnowledgeBaseApi 调用 POST /knowledge', async () => {
    const kb = makeKnowledgeBase();
    fetchMock.mockResolvedValueOnce(okEnvelope(kb));
    const result = await createKnowledgeBaseApi({
      name: '产品文档',
      visibility: 'public',
    });
    expect(result).toEqual(kb);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: '产品文档', visibility: 'public' }),
      }),
    );
  });

  it('listKnowledgeBasesApi 携带分页/过滤参数', async () => {
    const data = {
      list: [makeKnowledgeBase()],
      total: 1,
      page: 1,
      pageSize: 10,
    };
    fetchMock.mockResolvedValueOnce(okEnvelope(data));
    const result = await listKnowledgeBasesApi({
      page: 1,
      pageSize: 10,
      visibility: 'public',
      name: '产品',
    });
    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge?page=1&pageSize=10&visibility=public&name=%E4%BA%A7%E5%93%81',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getKnowledgeBaseApi 调用 GET 详情', async () => {
    const kb = makeKnowledgeBase();
    fetchMock.mockResolvedValueOnce(okEnvelope(kb));
    await expect(getKnowledgeBaseApi('kb1')).resolves.toEqual(kb);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('updateKnowledgeBaseApi 调用 PATCH', async () => {
    const kb = makeKnowledgeBase({ name: '新标题' });
    fetchMock.mockResolvedValueOnce(okEnvelope(kb));
    const result = await updateKnowledgeBaseApi('kb1', {
      name: '新标题',
      visibility: 'private',
    });
    expect(result).toEqual(kb);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: '新标题', visibility: 'private' }),
      }),
    );
  });

  it('deleteKnowledgeBaseApi 调用 DELETE', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(null));
    await expect(deleteKnowledgeBaseApi('kb1')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('addDocumentApi 以 FormData 上传文件并去除 Content-Type', async () => {
    const doc = makeDocument();
    fetchMock.mockResolvedValueOnce(okEnvelope(doc));
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });
    const result = await addDocumentApi('kb1', file);
    expect(result).toEqual(doc);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/knowledge/kb1/documents');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toEqual(file);
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
  });

  it('listDocumentsApi 携带分页/关键字参数', async () => {
    const data = { list: [makeDocument()], total: 1, page: 1, pageSize: 20 };
    fetchMock.mockResolvedValueOnce(okEnvelope(data));
    const result = await listDocumentsApi('kb1', {
      page: 1,
      pageSize: 20,
      keyword: 'hello',
    });
    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1/documents?page=1&pageSize=20&keyword=hello',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('getDocumentApi 调用 GET 文档详情', async () => {
    const doc = makeDocument();
    fetchMock.mockResolvedValueOnce(okEnvelope(doc));
    await expect(getDocumentApi('kb1', 'd1')).resolves.toEqual(doc);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1/documents/d1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('deleteDocumentApi 调用 DELETE 文档', async () => {
    fetchMock.mockResolvedValueOnce(okEnvelope(null));
    await expect(deleteDocumentApi('kb1', 'd1')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/kb1/documents/d1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
