import type { KnowledgeBase, KnowledgeDocument } from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAddDocument,
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocument,
  useDocumentList,
  useKnowledgeBase,
  useKnowledgeBaseList,
  useUpdateKnowledgeBase,
} from './use-knowledge';

const api = vi.hoisted(() => ({
  listKnowledgeBasesApi: vi.fn(),
  getKnowledgeBaseApi: vi.fn(),
  createKnowledgeBaseApi: vi.fn(),
  updateKnowledgeBaseApi: vi.fn(),
  deleteKnowledgeBaseApi: vi.fn(),
  listDocumentsApi: vi.fn(),
  getDocumentApi: vi.fn(),
  addDocumentApi: vi.fn(),
  deleteDocumentApi: vi.fn(),
}));

vi.mock('@/api/knowledge', () => api);

function makeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
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

function makeDoc(
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

describe('useKnowledgeBaseList', () => {
  it('以默认分页调用列表接口', async () => {
    const data = { list: [makeBase()], total: 1, page: 1, pageSize: 20 };
    api.listKnowledgeBasesApi.mockResolvedValue(data);
    const { result } = renderHook(() => useKnowledgeBaseList(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledWith({});
    expect(result.current.data).toEqual(data);
  });
});

describe('useKnowledgeBase', () => {
  it('id 为空时禁用请求', () => {
    const { result } = renderHook(() => useKnowledgeBase(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.getKnowledgeBaseApi).not.toHaveBeenCalled();
  });

  it('加载知识库详情', async () => {
    api.getKnowledgeBaseApi.mockResolvedValue(makeBase());
    const { result } = renderHook(() => useKnowledgeBase('kb1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getKnowledgeBaseApi).toHaveBeenCalledWith('kb1');
    expect(result.current.data?.id).toBe('kb1');
  });
});

describe('useCreateKnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('创建后调用 createKnowledgeBaseApi 并返回结果', async () => {
    const created = makeBase();
    api.createKnowledgeBaseApi.mockResolvedValue(created);

    const mutation = renderHook(() => useCreateKnowledgeBase(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        name: '产品文档',
        visibility: 'public',
      });
    });
    expect(api.createKnowledgeBaseApi).toHaveBeenCalledWith({
      name: '产品文档',
      visibility: 'public',
    });
    await waitFor(() => expect(mutation.result.current.data).toEqual(created));
  });
});

describe('useUpdateKnowledgeBase', () => {
  it('更新后调用 updateKnowledgeBaseApi', async () => {
    const updated = makeBase({ name: '新标题' });
    api.updateKnowledgeBaseApi.mockResolvedValue(updated);

    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        input: { name: '新标题', visibility: 'public' },
      });
    });
    expect(api.updateKnowledgeBaseApi).toHaveBeenCalledWith('kb1', {
      name: '新标题',
      visibility: 'public',
    });
    await waitFor(() => expect(mutation.result.current.data).toEqual(updated));
  });
});

describe('useDeleteKnowledgeBase', () => {
  it('删除后调用 deleteKnowledgeBaseApi', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    expect(api.deleteKnowledgeBaseApi).toHaveBeenCalledWith('kb1');
    await waitFor(() => expect(mutation.result.current.data).toBeNull());
  });
});

describe('useDocumentList', () => {
  it('kbId 为空时禁用请求', () => {
    const { result } = renderHook(() => useDocumentList(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.listDocumentsApi).not.toHaveBeenCalled();
  });

  it('加载文档列表', async () => {
    const data = { list: [makeDoc()], total: 1, page: 1, pageSize: 20 };
    api.listDocumentsApi.mockResolvedValue(data);
    const { result } = renderHook(() => useDocumentList('kb1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listDocumentsApi).toHaveBeenCalledWith('kb1', {});
    expect(result.current.data).toEqual(data);
  });
});

describe('useDocument', () => {
  it('id 缺失时禁用请求', () => {
    const { result } = renderHook(() => useDocument('kb1', undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.getDocumentApi).not.toHaveBeenCalled();
  });

  it('加载文档详情', async () => {
    api.getDocumentApi.mockResolvedValue(makeDoc());
    const { result } = renderHook(() => useDocument('kb1', 'd1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getDocumentApi).toHaveBeenCalledWith('kb1', 'd1');
    expect(result.current.data?.id).toBe('d1');
  });
});

describe('useAddDocument', () => {
  it('上传后调用 addDocumentApi 并返回文档', async () => {
    const doc = makeDoc();
    api.addDocumentApi.mockResolvedValue(doc);
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });
    const mutation = renderHook(() => useAddDocument(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({ kbId: 'kb1', file });
    });
    expect(api.addDocumentApi).toHaveBeenCalledWith('kb1', file);
    await waitFor(() => expect(mutation.result.current.data).toEqual(doc));
  });
});

describe('useDeleteDocument', () => {
  it('删除后调用 deleteDocumentApi', async () => {
    api.deleteDocumentApi.mockResolvedValue(null);
    const mutation = renderHook(() => useDeleteDocument(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({ kbId: 'kb1', id: 'd1' });
    });
    expect(api.deleteDocumentApi).toHaveBeenCalledWith('kb1', 'd1');
    await waitFor(() => expect(mutation.result.current.data).toBeNull());
  });
});
