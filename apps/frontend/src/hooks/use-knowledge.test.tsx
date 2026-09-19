import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeDocumentListItem,
} from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_PAGE_SIZE,
  knowledgeKeys,
  useAddDocument,
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocument,
  useInfiniteDocumentList,
  useInfiniteKnowledgeBaseList,
  useKnowledgeBase,
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from './use-knowledge.js';

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
  likeKnowledgeBaseApi: vi.fn(),
  unlikeKnowledgeBaseApi: vi.fn(),
}));

vi.mock('@/api/knowledge', () => api);

/** 知识库数据工厂 */
function makeBase(overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb1',
    ownerId: 'u1',
    visibility: 'private',
    name: '产品文档',
    description: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    likeCount: 0,
    isLiked: false,
    ...overrides,
  };
}

/** 文档数据工厂（详情/上传返回，含解析全文） */
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

/** 文档**列表项**工厂：列表契约不含 content（服务端做列投影） */
function makeDocListItem(
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem {
  return {
    id: 'd1',
    knowledgeBaseId: 'kb1',
    fileId: 'f1',
    title: 'intro',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** 游标分页响应工厂 */
function cursorPage<T>(list: T[], nextCursor: string | null = null) {
  return { list, nextCursor };
}

/** 无限查询缓存工厂 */
function infiniteCache<T>(
  pages: Array<{ list: T[]; nextCursor: string | null }>,
) {
  return {
    pages,
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function createWrapperWithClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function createWrapper() {
  return createWrapperWithClient(createTestQueryClient());
}

const defaultListKey = () =>
  knowledgeKeys.baseList({ limit: KNOWLEDGE_PAGE_SIZE });

describe('useInfiniteKnowledgeBaseList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('首次加载以空游标请求首页', async () => {
    const page = cursorPage([makeBase()], null);
    api.listKnowledgeBasesApi.mockResolvedValue(page);
    const { result } = renderHook(() => useInfiniteKnowledgeBaseList(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledWith({
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: undefined,
    });
    expect(result.current.data?.pages[0]).toEqual(page);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('nextCursor 存在时翻页并以游标请求下一页', async () => {
    api.listKnowledgeBasesApi.mockImplementation(
      (query: { cursor?: string } = {}) =>
        Promise.resolve(
          query.cursor
            ? cursorPage([makeBase({ id: 'b' })], null)
            : cursorPage([makeBase({ id: 'a' })], 'c1'),
        ),
    );
    const { result } = renderHook(() => useInfiniteKnowledgeBaseList(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listKnowledgeBasesApi).toHaveBeenLastCalledWith({
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: 'c1',
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('过滤条件进入 queryKey', async () => {
    api.listKnowledgeBasesApi.mockResolvedValue(cursorPage([], null));
    const client = createTestQueryClient();
    renderHook(
      () =>
        useInfiniteKnowledgeBaseList({ name: '产品', visibility: 'public' }),
      { wrapper: createWrapperWithClient(client) },
    );
    await waitFor(() =>
      expect(api.listKnowledgeBasesApi).toHaveBeenCalledWith({
        name: '产品',
        visibility: 'public',
        limit: KNOWLEDGE_PAGE_SIZE,
        cursor: undefined,
      }),
    );
  });

  it('卸载后在 gcTime 内重新挂载不重放历史分页', async () => {
    api.listKnowledgeBasesApi.mockResolvedValue(cursorPage([makeBase()], 'c1'));
    const client = createTestQueryClient();
    const { result, unmount } = renderHook(
      () => useInfiniteKnowledgeBaseList(),
      { wrapper: createWrapperWithClient(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(defaultListKey())).toBeDefined();

    unmount();

    // 缓存未到 gcTime：保留而非释放
    expect(client.getQueryData(defaultListKey())).toBeDefined();

    renderHook(() => useInfiniteKnowledgeBaseList(), {
      wrapper: createWrapperWithClient(client),
    });
    // 给潜在的 refetch 留出微/宏任务窗口
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(1);
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
    expect(result.current.data?.id).toBe('kb1');
  });
});

describe('useCreateKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  it('创建后插入匹配过滤条件的列表首页顶部（不 refetch）', async () => {
    const created = makeBase({ id: 'kb-new', name: '新产品' });
    api.createKnowledgeBaseApi.mockResolvedValue(created);
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([cursorPage([makeBase({ id: 'kb1' })])]),
    );
    const mutation = renderHook(() => useCreateKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        name: '新产品',
        visibility: 'private',
      });
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(defaultListKey());
    expect(cached?.pages[0].list.map((kb) => kb.id)).toEqual(['kb-new', 'kb1']);
  });

  it('不匹配当前过滤条件时不插入列表', async () => {
    const created = makeBase({ id: 'kb-priv', visibility: 'private' });
    api.createKnowledgeBaseApi.mockResolvedValue(created);
    const client = createTestQueryClient();
    const publicKey = knowledgeKeys.baseList({
      limit: KNOWLEDGE_PAGE_SIZE,
      visibility: 'public',
    });
    client.setQueryData(
      publicKey,
      infiniteCache([
        cursorPage([makeBase({ id: 'kb1', visibility: 'public' })]),
      ]),
    );
    const mutation = renderHook(() => useCreateKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        name: '私有库',
        visibility: 'private',
      });
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(publicKey);
    expect(cached?.pages[0].list.map((kb) => kb.id)).toEqual(['kb1']);
  });
});

describe('useUpdateKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  it('乐观就地更新列表分页与详情缓存', async () => {
    const updated = makeBase({
      id: 'kb1',
      name: '新标题',
      visibility: 'public',
      updatedAt: '2024-02-02T00:00:00Z',
    });
    api.updateKnowledgeBaseApi.mockResolvedValue(updated);
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([cursorPage([makeBase()])]),
    );
    client.setQueryData(knowledgeKeys.base('kb1'), makeBase());
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        input: { name: '新标题', visibility: 'public' },
      });
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(defaultListKey());
    expect(cached?.pages[0].list[0].name).toBe('新标题');
    expect(cached?.pages[0].list[0].visibility).toBe('public');
    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.name,
    ).toBe('新标题');
  });

  it('失败时回滚列表与详情缓存', async () => {
    api.updateKnowledgeBaseApi.mockRejectedValue(new Error('network error'));
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([cursorPage([makeBase()])]),
    );
    client.setQueryData(knowledgeKeys.base('kb1'), makeBase());
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      try {
        await mutation.result.current.mutateAsync({
          id: 'kb1',
          input: { name: '新标题', visibility: 'private' },
        });
      } catch {
        // 预期失败
      }
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(defaultListKey());
    expect(cached?.pages[0].list[0].name).toBe('产品文档');
    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.name,
    ).toBe('产品文档');
  });
});

describe('useDeleteKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  it('乐观从列表分页移除并清掉详情缓存', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([
        cursorPage([makeBase({ id: 'kb1' }), makeBase({ id: 'kb2' })]),
      ]),
    );
    client.setQueryData(knowledgeKeys.base('kb1'), makeBase());
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(defaultListKey());
    expect(cached?.pages[0].list.map((kb) => kb.id)).toEqual(['kb2']);
    expect(client.getQueryData(knowledgeKeys.base('kb1'))).toBeUndefined();
  });

  it('失败时回滚列表缓存', async () => {
    api.deleteKnowledgeBaseApi.mockRejectedValue(new Error('network error'));
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([cursorPage([makeBase()])]),
    );
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      try {
        await mutation.result.current.mutateAsync('kb1');
      } catch {
        // 预期失败
      }
    });
    const cached = client.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(defaultListKey());
    expect(cached?.pages[0].list.map((kb) => kb.id)).toEqual(['kb1']);
  });
});

/** 点赞/取消点赞 mutation 的通用测试 */
function describeLikeMutationTests(opts: {
  name: string;
  useHook: () => {
    mutateAsync: (id: string) => Promise<unknown>;
  };
  apiMock: ReturnType<typeof vi.fn>;
  initialIsLiked: boolean;
}) {
  describe(opts.name, () => {
    beforeEach(() => vi.clearAllMocks());

    it('成功后以服务端返回值覆盖缓存', async () => {
      opts.apiMock.mockResolvedValue({
        likeCount: 9,
        isLiked: !opts.initialIsLiked,
      });
      const client = createTestQueryClient();
      client.setQueryData(
        defaultListKey(),
        infiniteCache([
          cursorPage([
            makeBase({
              id: 'kb1',
              likeCount: 4,
              isLiked: opts.initialIsLiked,
            }),
          ]),
        ]),
      );
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapperWithClient(client),
      });
      await act(async () => {
        await mutation.result.current.mutateAsync('kb1');
      });
      const cached = client.getQueryData<{
        pages: Array<{ list: KnowledgeBase[] }>;
      }>(defaultListKey());
      expect(cached?.pages[0].list[0].isLiked).toBe(!opts.initialIsLiked);
      expect(cached?.pages[0].list[0].likeCount).toBe(9);
    });

    it('失败时回滚缓存', async () => {
      opts.apiMock.mockRejectedValue(new Error('network error'));
      const client = createTestQueryClient();
      client.setQueryData(
        defaultListKey(),
        infiniteCache([
          cursorPage([
            makeBase({
              id: 'kb1',
              likeCount: 4,
              isLiked: opts.initialIsLiked,
            }),
          ]),
        ]),
      );
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapperWithClient(client),
      });
      await act(async () => {
        try {
          await mutation.result.current.mutateAsync('kb1');
        } catch {
          // 预期失败
        }
      });
      const cached = client.getQueryData<{
        pages: Array<{ list: KnowledgeBase[] }>;
      }>(defaultListKey());
      expect(cached?.pages[0].list[0].isLiked).toBe(opts.initialIsLiked);
      expect(cached?.pages[0].list[0].likeCount).toBe(4);
    });
  });
}

describeLikeMutationTests({
  name: 'useLikeKnowledgeBase',
  useHook: useLikeKnowledgeBase,
  apiMock: api.likeKnowledgeBaseApi,
  initialIsLiked: false,
});

describeLikeMutationTests({
  name: 'useUnlikeKnowledgeBase',
  useHook: useUnlikeKnowledgeBase,
  apiMock: api.unlikeKnowledgeBaseApi,
  initialIsLiked: true,
});

describe('useLikeKnowledgeBase 乐观计数', () => {
  beforeEach(() => vi.clearAllMocks());

  it('缓存中存在目标时立即 +1', async () => {
    let resolveApi: (v: unknown) => void = () => {};
    api.likeKnowledgeBaseApi.mockImplementation(
      () => new Promise((resolve) => (resolveApi = resolve)),
    );
    const client = createTestQueryClient();
    client.setQueryData(
      defaultListKey(),
      infiniteCache([cursorPage([makeBase({ likeCount: 3, isLiked: false })])]),
    );
    const mutation = renderHook(() => useLikeKnowledgeBase(), {
      wrapper: createWrapperWithClient(client),
    });
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = mutation.result.current.mutateAsync('kb1');
    });
    await waitFor(() => {
      const cached = client.getQueryData<{
        pages: Array<{ list: KnowledgeBase[] }>;
      }>(defaultListKey());
      expect(cached?.pages[0].list[0].likeCount).toBe(4);
      expect(cached?.pages[0].list[0].isLiked).toBe(true);
    });
    await act(async () => {
      resolveApi({ likeCount: 4, isLiked: true });
      await pending;
    });
  });
});

describe('useInfiniteDocumentList', () => {
  it('kbId 为空时禁用请求', () => {
    const { result } = renderHook(() => useInfiniteDocumentList(undefined), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.listDocumentsApi).not.toHaveBeenCalled();
  });

  it('以游标请求首页并按 nextCursor 翻页', async () => {
    api.listDocumentsApi.mockImplementation(
      (_kbId: string, query: { cursor?: string } = {}) =>
        Promise.resolve(
          query.cursor
            ? cursorPage([makeDocListItem({ id: 'd2' })], null)
            : cursorPage([makeDocListItem({ id: 'd1' })], 'dc1'),
        ),
    );
    const { result } = renderHook(() => useInfiniteDocumentList('kb1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listDocumentsApi).toHaveBeenCalledWith('kb1', {
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: undefined,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listDocumentsApi).toHaveBeenLastCalledWith('kb1', {
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: 'dc1',
    });
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
  });
});

describe('useAddDocument', () => {
  it('上传后调用 addDocumentApi 并失效文档列表', async () => {
    const doc = makeDoc();
    api.addDocumentApi.mockResolvedValue(doc);
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });
    const mutation = renderHook(() => useAddDocument(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({ kbId: 'kb1', file });
    });
    expect(api.addDocumentApi).toHaveBeenCalledWith('kb1', file);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: knowledgeKeys.documentListAll('kb1'),
    });
  });
});

describe('useDeleteDocument', () => {
  it('删除后调用 deleteDocumentApi 并清掉详情缓存', async () => {
    api.deleteDocumentApi.mockResolvedValue(null);
    const client = createTestQueryClient();
    client.setQueryData(knowledgeKeys.document('kb1', 'd1'), makeDoc());
    const mutation = renderHook(() => useDeleteDocument(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({ kbId: 'kb1', id: 'd1' });
    });
    expect(api.deleteDocumentApi).toHaveBeenCalledWith('kb1', 'd1');
    expect(
      client.getQueryData(knowledgeKeys.document('kb1', 'd1')),
    ).toBeUndefined();
  });
});
