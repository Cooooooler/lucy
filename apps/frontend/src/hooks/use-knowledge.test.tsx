import type { KnowledgeBase, KnowledgeDocument } from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAddDocument,
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocument,
  useDocumentList,
  useInfiniteDocumentList,
  useInfiniteKnowledgeBaseList,
  useKnowledgeBase,
  useKnowledgeBaseList,
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
    ...overrides,
  };
}

/** 文档数据工厂 */
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

/** 创建测试用 QueryClient */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** 创建测试用 QueryClient wrapper */
function createWrapper() {
  const queryClient = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/** 创建带 QueryClient 的 wrapper */
function createWrapperWithClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** 列表缓存数据工厂 */
function makeListCache(items: KnowledgeBase[], total = items.length) {
  return { list: items, total, page: 1, pageSize: 20 };
}

/** 无限滚动缓存数据工厂 */
function makeInfiniteCache(
  pages: Array<{ list: KnowledgeBase[]; total: number }>,
) {
  return {
    pages: pages.map((p, i) => ({ ...p, page: i + 1, pageSize: 20 })),
    pageParams: pages.map((_, i) => i + 1),
  };
}

/** 分页数据工厂 */
function makePage<T>(items: T[], page: number, total = items.length) {
  return { list: items, total, page, pageSize: 20 };
}

/** 无限滚动通用测试：首次加载、翻页、结束 */
function describeInfiniteQueryTests(opts: {
  name: string;
  useHook: (id?: string) => {
    data: { pages: unknown[] } | undefined;
    hasNextPage: boolean;
    isSuccess: boolean;
    fetchNextPage: () => void;
  };
  apiMock: Mock;
  singlePageData: unknown;
  firstPageData: unknown;
  secondPageData: unknown;
  id?: string;
}) {
  describe(opts.name, () => {
    it('首次加载调用接口并使用默认分页', async () => {
      opts.apiMock.mockResolvedValue(opts.singlePageData);
      const { result } = renderHook(() => opts.useHook(opts.id), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.pages).toHaveLength(1);
      expect(result.current.data?.pages[0]).toEqual(opts.singlePageData);
    });

    it('还有更多数据时提供下一页参数', async () => {
      opts.apiMock
        .mockResolvedValueOnce(opts.firstPageData)
        .mockResolvedValueOnce(opts.secondPageData);
      const { result } = renderHook(() => opts.useHook(opts.id), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(true);
      await act(async () => {
        await result.current.fetchNextPage();
      });
      await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
      expect(result.current.hasNextPage).toBe(false);
      expect(result.current.data?.pages[1]).toEqual(opts.secondPageData);
    });

    it('数据已加载完时不提供下一页参数', async () => {
      opts.apiMock.mockResolvedValue(opts.singlePageData);
      const { result } = renderHook(() => opts.useHook(opts.id), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(false);
    });
  });
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

describeInfiniteQueryTests({
  name: 'useInfiniteKnowledgeBaseList',
  useHook: () => useInfiniteKnowledgeBaseList(),
  apiMock: api.listKnowledgeBasesApi,
  singlePageData: makePage([makeBase()], 1, 1),
  firstPageData: makePage([makeBase({ id: 'a' })], 1, 40),
  secondPageData: makePage([makeBase({ id: 'b' })], 2, 40),
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
  beforeEach(() => vi.clearAllMocks());

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
  beforeEach(() => vi.clearAllMocks());

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

  it('乐观更新列表缓存，不触发 refetch', async () => {
    const updated = makeBase({ name: '新标题', visibility: 'public' });
    api.updateKnowledgeBaseApi.mockResolvedValue(updated);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'list'],
      makeListCache([makeBase({ id: 'kb1', visibility: 'private' })]),
    );
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        input: { name: '新标题', visibility: 'public' },
      });
    });
    // 缓存应立即更新
    const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
      'knowledge',
      'bases',
      'list',
    ]);
    expect(cached?.list[0].name).toBe('新标题');
    expect(cached?.list[0].visibility).toBe('public');
    // 列表长度不变（位置不变）
    expect(cached?.list).toHaveLength(1);
  });

  it('乐观更新无限滚动缓存', async () => {
    const updated = makeBase({ visibility: 'public' });
    api.updateKnowledgeBaseApi.mockResolvedValue(updated);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'list', 'infinite', {}],
      makeInfiniteCache([
        { list: [makeBase({ id: 'kb1', visibility: 'private' })], total: 1 },
      ]),
    );
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        input: { visibility: 'public' },
      });
    });
    const cached = queryClient.getQueryData<{
      pages: Array<{ list: KnowledgeBase[] }>;
    }>(['knowledge', 'bases', 'list', 'infinite', {}]);
    expect(cached?.pages[0].list[0].visibility).toBe('public');
  });

  it('失败时回滚列表缓存', async () => {
    api.updateKnowledgeBaseApi.mockRejectedValue(new Error('network error'));
    const queryClient = createTestQueryClient();
    const originalList = makeListCache([
      makeBase({ id: 'kb1', name: '产品文档', visibility: 'private' }),
    ]);
    queryClient.setQueryData(['knowledge', 'bases', 'list'], originalList);
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      try {
        await mutation.result.current.mutateAsync({
          id: 'kb1',
          input: { name: '新标题', visibility: 'public' },
        });
      } catch {
        // 预期失败
      }
    });
    const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
      'knowledge',
      'bases',
      'list',
    ]);
    // 回滚到原始值
    expect(cached?.list[0].name).toBe('产品文档');
    expect(cached?.list[0].visibility).toBe('private');
  });
});

describe('useDeleteKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('乐观从列表缓存移除知识库，不触发 refetch', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const queryClient = createTestQueryClient();
    const listData = makeListCache([
      makeBase({ id: 'kb1' }),
      makeBase({ id: 'kb2', name: '其他' }),
    ]);
    queryClient.setQueryData(['knowledge', 'bases', 'list'], listData);
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    const cached = queryClient.getQueryData<typeof listData>([
      'knowledge',
      'bases',
      'list',
    ]);
    // kb1 被移除，kb2 保留
    expect(cached?.list).toHaveLength(1);
    expect(cached?.list[0].id).toBe('kb2');
    // total 减 1
    expect(cached?.total).toBe(1);
  });

  it('乐观从无限滚动缓存移除知识库', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'list', 'infinite', {}],
      makeInfiniteCache([
        {
          list: [
            makeBase({ id: 'kb1' }),
            makeBase({ id: 'kb2', name: '其他' }),
          ],
          total: 2,
        },
      ]),
    );
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    const cached = queryClient.getQueryData<{
      pages: Array<{ list: KnowledgeBase[]; total: number }>;
    }>(['knowledge', 'bases', 'list', 'infinite', {}]);
    expect(cached?.pages[0].list).toHaveLength(1);
    expect(cached?.pages[0].list[0].id).toBe('kb2');
    expect(cached?.pages[0].total).toBe(1);
  });

  it('移除 base 单条缓存及其文档缓存', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'kb1'],
      makeBase({ id: 'kb1' }),
    );
    queryClient.setQueryData(
      ['knowledge', 'bases', 'kb1', 'documents'],
      ['doc1', 'doc2'],
    );
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    expect(
      queryClient.getQueryData(['knowledge', 'bases', 'kb1']),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(['knowledge', 'bases', 'kb1', 'documents']),
    ).toBeUndefined();
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

describeInfiniteQueryTests({
  name: 'useInfiniteDocumentList',
  useHook: (id?: string) => useInfiniteDocumentList(id),
  apiMock: api.listDocumentsApi,
  id: 'kb1',
  singlePageData: makePage([makeDoc()], 1, 1),
  firstPageData: makePage([makeDoc({ id: 'd1' })], 1, 40),
  secondPageData: makePage([makeDoc({ id: 'd2' })], 2, 40),
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

/** 点赞/取消点赞 mutation 的通用测试 */
function describeLikeMutationTests(opts: {
  name: string;
  useHook: () => {
    mutateAsync: (id: string) => Promise<unknown>;
    data: unknown;
  };
  apiMock: ReturnType<typeof vi.fn>;
  initialIsLiked: boolean;
}) {
  describe(opts.name, () => {
    beforeEach(() => vi.clearAllMocks());

    it('调用 API 并返回结果', async () => {
      const expected = { likeCount: 1, isLiked: !opts.initialIsLiked };
      opts.apiMock.mockResolvedValue(expected);
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapper(),
      });
      await act(async () => {
        await mutation.result.current.mutateAsync('kb1');
      });
      expect(opts.apiMock).toHaveBeenCalledWith('kb1', expect.anything());
      await waitFor(() =>
        expect(mutation.result.current.data).toEqual(expected),
      );
    });

    it('成功后更新列表缓存', async () => {
      opts.apiMock.mockResolvedValue({
        likeCount: 5,
        isLiked: !opts.initialIsLiked,
      });
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(
        ['knowledge', 'bases', 'list'],
        makeListCache([
          makeBase({ id: 'kb1', likeCount: 4, isLiked: opts.initialIsLiked }),
        ]),
      );
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapperWithClient(queryClient),
      });
      await act(async () => {
        await mutation.result.current.mutateAsync('kb1');
      });
      const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
        'knowledge',
        'bases',
        'list',
      ]);
      expect(cached?.list[0].isLiked).toBe(!opts.initialIsLiked);
      expect(cached?.list[0].likeCount).toBe(5);
    });

    it('失败时回滚列表缓存', async () => {
      opts.apiMock.mockRejectedValue(new Error('network error'));
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(
        ['knowledge', 'bases', 'list'],
        makeListCache([
          makeBase({ id: 'kb1', likeCount: 4, isLiked: opts.initialIsLiked }),
        ]),
      );
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapperWithClient(queryClient),
      });
      await act(async () => {
        try {
          await mutation.result.current.mutateAsync('kb1');
        } catch {
          // 预期失败
        }
      });
      const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
        'knowledge',
        'bases',
        'list',
      ]);
      expect(cached?.list[0].isLiked).toBe(opts.initialIsLiked);
      expect(cached?.list[0].likeCount).toBe(4);
    });

    it('更新无限滚动缓存', async () => {
      opts.apiMock.mockResolvedValue({
        likeCount: 2,
        isLiked: !opts.initialIsLiked,
      });
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(
        ['knowledge', 'bases', 'list', 'infinite', {}],
        makeInfiniteCache([
          {
            list: [
              makeBase({
                id: 'kb1',
                likeCount: 1,
                isLiked: opts.initialIsLiked,
              }),
            ],
            total: 1,
          },
        ]),
      );
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapperWithClient(queryClient),
      });
      await act(async () => {
        await mutation.result.current.mutateAsync('kb1');
      });
      const cached = queryClient.getQueryData<{
        pages: Array<{ list: KnowledgeBase[] }>;
      }>(['knowledge', 'bases', 'list', 'infinite', {}]);
      expect(cached?.pages[0].list[0].isLiked).toBe(!opts.initialIsLiked);
      expect(cached?.pages[0].list[0].likeCount).toBe(2);
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

describe('useLikeKnowledgeBase 额外场景', () => {
  beforeEach(() => vi.clearAllMocks());

  it('缓存中不存在目标知识库时 likeCount 从 0 开始', async () => {
    api.likeKnowledgeBaseApi.mockResolvedValue({ likeCount: 1, isLiked: true });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'list'],
      makeListCache([
        makeBase({ id: 'other', name: '其他', likeCount: 10, isLiked: false }),
      ]),
    );
    const mutation = renderHook(() => useLikeKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb999');
    });
    const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
      'knowledge',
      'bases',
      'list',
    ]);
    expect(cached?.list[0].id).toBe('other');
    expect(cached?.list[0].likeCount).toBe(10);
  });

  it('base 缓存 likeCount 为 0 时使用列表缓存的值', async () => {
    api.likeKnowledgeBaseApi.mockResolvedValue({
      likeCount: 11,
      isLiked: true,
    });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ['knowledge', 'bases', 'kb1'],
      makeBase({ id: 'kb1', likeCount: 0, isLiked: false }),
    );
    queryClient.setQueryData(
      ['knowledge', 'bases', 'list'],
      makeListCache([makeBase({ id: 'kb1', likeCount: 10, isLiked: false })]),
    );
    const mutation = renderHook(() => useLikeKnowledgeBase(), {
      wrapper: createWrapperWithClient(queryClient),
    });
    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });
    const cached = queryClient.getQueryData<{ list: KnowledgeBase[] }>([
      'knowledge',
      'bases',
      'list',
    ]);
    expect(cached?.list[0].isLiked).toBe(true);
    expect(cached?.list[0].likeCount).toBe(11);
  });
});
