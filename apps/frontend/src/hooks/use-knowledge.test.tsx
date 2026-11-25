import type { KnowledgeBase } from '@/api/types';
// 文档夹具与 api/knowledge.test.ts、详情路由用例共用（见 src/test/fixtures.ts）：
// 三处各写一份同样的工厂会让新代码重复率顶红 Sonar 门禁
import {
  makeDocument as makeDoc,
  makeDocumentListItem as makeDocListItem,
} from '@/test/fixtures';
import {
  createTestQueryClient,
  createQueryWrapper as createWrapper,
} from '@/test/query';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_PAGE_SIZE,
  knowledgeKeys,
  useAddDocument,
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocument,
  useDocumentList,
  useInfiniteKnowledgeBaseList,
  useKnowledgeBase,
  useLikeKnowledgeBase,
  useRefreshKnowledgeBaseList,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
  useUpdateKnowledgeVisibility,
} from './use-knowledge.js';

const api = vi.hoisted(() => ({
  listKnowledgeBasesApi: vi.fn(),
  getKnowledgeBaseApi: vi.fn(),
  createKnowledgeBaseApi: vi.fn(),
  updateKnowledgeBaseApi: vi.fn(),
  updateKnowledgeVisibilityApi: vi.fn(),
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
    description: '这是一段描述',
    retrievalMode: 'fulltext',
    topK: 5,
    scoreThresholdEnabled: false,
    scoreThreshold: 0,
    semanticWeight: 50,
    rerankModelId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    likeCount: 0,
    isLiked: false,
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

/** 手动控制完成时机的 Promise：用来断言「请求还没回来时缓存已被乐观改写」 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 从无限列表缓存取第一页第一条（乐观更新的断言用） */
function firstListItem(
  client: QueryClient,
  key: QueryKey,
): KnowledgeBase | undefined {
  const cache = client.getQueryData<{
    pages: Array<{ list: KnowledgeBase[] }>;
  }>(key);
  return cache?.pages[0]?.list[0];
}

/** 无筛选的列表 key，测试里最常用 */
function unfilteredListKey() {
  return knowledgeKeys.baseList({ limit: KNOWLEDGE_PAGE_SIZE });
}

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
    renderHook(
      () =>
        useInfiniteKnowledgeBaseList({ name: '产品', visibility: 'public' }),
      { wrapper: createWrapper() },
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

  it('换筛选后切回 3 分钟内复用缓存，不重新请求', async () => {
    api.listKnowledgeBasesApi.mockImplementation(
      (query: { visibility?: string; cursor?: string } = {}) => {
        if (query.visibility === 'private') {
          return Promise.resolve(cursorPage([makeBase({ id: 'priv' })], null));
        }
        return Promise.resolve(
          query.cursor
            ? cursorPage([makeBase({ id: 'all2' })], null)
            : cursorPage([makeBase({ id: 'all1' })], 'c1'),
        );
      },
    );
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(
      (props: { visibility?: 'private' | 'public' }) =>
        useInfiniteKnowledgeBaseList(props),
      { wrapper: createWrapper(client), initialProps: {} },
    );

    // 全部：先加载两页
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(2);

    // 切到私有：新条件正常请求一次
    rerender({ visibility: 'private' });
    await waitFor(() =>
      expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(3),
    );
    expect(result.current.isPlaceholderData).toBe(false);

    // gcTime 继承基础配置（5 分钟）：两个筛选的缓存并存；
    // staleTime 为 3 分钟，切回「全部」直接复用，不再请求
    rerender({});
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(
      client.getQueryCache().findAll({ queryKey: knowledgeKeys.baseListAll() }),
    ).toHaveLength(2);
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(3);
  });

  it('翻到第 2 页后离开再进入，3 分钟内复用缓存（不重放分页）', async () => {
    api.listKnowledgeBasesApi.mockImplementation(
      (query: { cursor?: string } = {}) =>
        Promise.resolve(
          query.cursor
            ? cursorPage([makeBase({ id: 'b' })], null)
            : cursorPage([makeBase({ id: 'a' })], 'c1'),
        ),
    );
    const client = createTestQueryClient();
    const { result, unmount } = renderHook(
      () => useInfiniteKnowledgeBaseList(),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(2);

    unmount();

    // gcTime 继承基础配置（5 分钟）且 3 分钟内仍新鲜：重新进入直接复用，不发请求
    const { result: remounted } = renderHook(
      () => useInfiniteKnowledgeBaseList(),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(remounted.current.isSuccess).toBe(true));

    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(2);
    expect(remounted.current.data?.pages).toHaveLength(2);
  });
});

describe('useRefreshKnowledgeBaseList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('丢弃所有筛选的列表缓存，只让当前筛选重取第一页（不重放）', async () => {
    api.listKnowledgeBasesApi.mockResolvedValue(
      cursorPage([makeBase({ id: 'kb1' })], null),
    );
    const client = createTestQueryClient();
    // 预置「公开」筛选的缓存，模拟之前访问过（刷新后应一并作废）
    const publicKey = knowledgeKeys.baseList({
      limit: KNOWLEDGE_PAGE_SIZE,
      visibility: 'public',
    });
    client.setQueryData(
      publicKey,
      infiniteCache([cursorPage([makeBase({ id: 'pub' })])]),
    );

    const { result } = renderHook(
      () => ({
        list: useInfiniteKnowledgeBaseList(),
        refresh: useRefreshKnowledgeBaseList(),
      }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    // 其它筛选的缓存被清空：下次进入同样从第一页重来
    expect(client.getQueryData(publicKey)).toBeUndefined();
    // 当前筛选只重新取第一页：总请求数为 2，不重放（invalidate 会重放整段分页）
    await waitFor(() =>
      expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(2),
    );
    expect(api.listKnowledgeBasesApi).toHaveBeenLastCalledWith({
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: undefined,
    });
    expect(result.current.list.data?.pages).toHaveLength(1);
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

  it('创建成功后按「刷新」处理：丢弃所有筛选的列表缓存并重取第一页', async () => {
    api.createKnowledgeBaseApi.mockResolvedValue(makeBase({ id: 'kb-new' }));
    api.listKnowledgeBasesApi.mockResolvedValue(cursorPage([makeBase()], null));
    const client = createTestQueryClient();
    // 预置「公开」筛选的缓存，模拟之前访问过（刷新后应一并作废）
    const publicKey = knowledgeKeys.baseList({
      limit: KNOWLEDGE_PAGE_SIZE,
      visibility: 'public',
    });
    client.setQueryData(
      publicKey,
      infiniteCache([cursorPage([makeBase({ id: 'pub' })])]),
    );

    const { result } = renderHook(
      () => ({
        list: useInfiniteKnowledgeBaseList(),
        create: useCreateKnowledgeBase(),
      }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.create.mutateAsync({
        name: '新产品',
        description: '新产品描述',
        visibility: 'private',
      });
    });

    expect(api.createKnowledgeBaseApi).toHaveBeenCalledTimes(1);
    // 其它筛选的缓存被清空：下次进入同样从第一页重来
    expect(client.getQueryData(publicKey)).toBeUndefined();
    // 当前筛选从第一页重新加载（不重放已加载分页）
    await waitFor(() =>
      expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(2),
    );
    expect(api.listKnowledgeBasesApi).toHaveBeenLastCalledWith({
      limit: KNOWLEDGE_PAGE_SIZE,
      cursor: undefined,
    });
    expect(result.current.list.data?.pages).toHaveLength(1);
  });
});

describe('useUpdateKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  const nameFilterKey = knowledgeKeys.baseList({
    limit: KNOWLEDGE_PAGE_SIZE,
    name: '产品',
  });

  /** 详情 + 无筛选列表 + 名称筛选列表都放一条匹配「产品」的条目 */
  function seed(client: QueryClient) {
    const item = makeBase({ name: '产品文档', visibility: 'public' });
    client.setQueryData(knowledgeKeys.base('kb1'), item);
    client.setQueryData(
      unfilteredListKey(),
      infiniteCache([cursorPage([item])]),
    );
    client.setQueryData(nameFilterKey, infiniteCache([cursorPage([item])]));
  }

  it('请求返回前就改写详情与列表；改名后不匹配的筛选列表立即移除条目', async () => {
    const pending = deferred<KnowledgeBase>();
    api.updateKnowledgeBaseApi.mockReturnValue(pending.promise);
    const client = createTestQueryClient();
    seed(client);
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapper(client),
    });

    act(() => {
      mutation.result.current.mutate({
        id: 'kb1',
        input: { name: '新标题', visibility: 'private' },
      });
    });

    // 请求还没回来，缓存已是新值
    await waitFor(() =>
      expect(
        client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1')),
      ).toMatchObject({ name: '新标题', visibility: 'private' }),
    );
    expect(firstListItem(client, unfilteredListKey())).toMatchObject({
      name: '新标题',
      visibility: 'private',
    });
    // 名称筛选不再匹配，条目立即消失
    expect(firstListItem(client, nameFilterKey)).toBeUndefined();

    await act(async () => {
      pending.resolve(makeBase({ name: '新标题', visibility: 'private' }));
      await pending.promise;
    });
    await waitFor(() => expect(mutation.result.current.isSuccess).toBe(true));
  });

  it('成功路径用响应收敛，不整段失效', async () => {
    api.updateKnowledgeBaseApi.mockResolvedValue(
      makeBase({ name: '新标题', visibility: 'private' }),
    );
    const client = createTestQueryClient();
    seed(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        input: { name: '新标题', visibility: 'private' },
      });
    });

    expect(api.updateKnowledgeBaseApi).toHaveBeenCalledWith('kb1', {
      name: '新标题',
      visibility: 'private',
    });
    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.name,
    ).toBe('新标题');
    expect(firstListItem(client, unfilteredListKey())?.name).toBe('新标题');
    expect(firstListItem(client, nameFilterKey)).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('失败时回滚详情与所有列表', async () => {
    api.updateKnowledgeBaseApi.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    seed(client);
    const mutation = renderHook(() => useUpdateKnowledgeBase(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(
        mutation.result.current.mutateAsync({
          id: 'kb1',
          input: { name: '新标题', visibility: 'private' },
        }),
      ).rejects.toThrow('boom');
    });

    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.name,
    ).toBe('产品文档');
    expect(firstListItem(client, unfilteredListKey())?.name).toBe('产品文档');
    expect(firstListItem(client, nameFilterKey)?.name).toBe('产品文档');
  });
});

describe('useUpdateKnowledgeVisibility', () => {
  beforeEach(() => vi.clearAllMocks());

  const publicFilterKey = knowledgeKeys.baseList({
    limit: KNOWLEDGE_PAGE_SIZE,
    visibility: 'public',
  });

  /** 详情 + 无筛选列表 + 公开筛选列表都放一条 public 条目 */
  function seed(client: QueryClient) {
    const item = makeBase({ visibility: 'public' });
    client.setQueryData(knowledgeKeys.base('kb1'), item);
    client.setQueryData(
      unfilteredListKey(),
      infiniteCache([cursorPage([item])]),
    );
    client.setQueryData(publicFilterKey, infiniteCache([cursorPage([item])]));
  }

  it('立即改写详情与匹配筛选的列表，并把条目移出不再匹配的筛选列表', async () => {
    api.updateKnowledgeVisibilityApi.mockResolvedValue(
      makeBase({ visibility: 'private' }),
    );
    const client = createTestQueryClient();
    seed(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const mutation = renderHook(() => useUpdateKnowledgeVisibility(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await mutation.result.current.mutateAsync({
        id: 'kb1',
        visibility: 'private',
      });
    });

    expect(api.updateKnowledgeVisibilityApi).toHaveBeenCalledWith(
      'kb1',
      'private',
    );
    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.visibility,
    ).toBe('private');
    expect(firstListItem(client, unfilteredListKey())?.visibility).toBe(
      'private',
    );
    // 当前筛选是「公开」，切成私有后条目立即消失，不留中间态
    expect(firstListItem(client, publicFilterKey)).toBeUndefined();
    // 成功路径用响应收敛，不整段失效（否则会重放已加载的分页）
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('失败时回滚详情与所有列表', async () => {
    api.updateKnowledgeVisibilityApi.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    seed(client);
    const mutation = renderHook(() => useUpdateKnowledgeVisibility(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(
        mutation.result.current.mutateAsync({
          id: 'kb1',
          visibility: 'private',
        }),
      ).rejects.toThrow('boom');
    });

    expect(
      client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1'))?.visibility,
    ).toBe('public');
    expect(firstListItem(client, unfilteredListKey())?.visibility).toBe(
      'public',
    );
    expect(firstListItem(client, publicFilterKey)?.visibility).toBe('public');
  });
});

describe('useDeleteKnowledgeBase', () => {
  beforeEach(() => vi.clearAllMocks());

  function seed(client: QueryClient) {
    client.setQueryData(knowledgeKeys.base('kb1'), makeBase());
    client.setQueryData(
      unfilteredListKey(),
      infiniteCache([cursorPage([makeBase()])]),
    );
  }

  it('立即从列表移除，成功后清掉详情缓存（不整段失效）', async () => {
    api.deleteKnowledgeBaseApi.mockResolvedValue(null);
    const client = createTestQueryClient();
    seed(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await mutation.result.current.mutateAsync('kb1');
    });

    expect(firstListItem(client, unfilteredListKey())).toBeUndefined();
    expect(client.getQueryData(knowledgeKeys.base('kb1'))).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('失败时把条目恢复到列表', async () => {
    api.deleteKnowledgeBaseApi.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    seed(client);
    const mutation = renderHook(() => useDeleteKnowledgeBase(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(mutation.result.current.mutateAsync('kb1')).rejects.toThrow(
        'boom',
      );
    });

    expect(firstListItem(client, unfilteredListKey())?.id).toBe('kb1');
    expect(client.getQueryData(knowledgeKeys.base('kb1'))).toBeDefined();
  });
});

type LikeState = { likeCount: number; isLiked: boolean };

/** 点赞/取消点赞 mutation 的通用测试 */
function describeLikeMutationTests(opts: {
  name: string;
  useHook: () => {
    mutate: (id: string) => void;
    mutateAsync: (id: string) => Promise<unknown>;
  };
  apiMock: ReturnType<typeof vi.fn>;
  before: LikeState;
  after: LikeState;
}) {
  describe(opts.name, () => {
    beforeEach(() => vi.clearAllMocks());

    function seed(client: QueryClient) {
      const item = makeBase(opts.before);
      client.setQueryData(knowledgeKeys.base('kb1'), item);
      client.setQueryData(
        unfilteredListKey(),
        infiniteCache([cursorPage([item])]),
      );
    }

    it('请求返回前就写入乐观态，成功后用服务端返回值收敛', async () => {
      const pending = deferred<LikeState>();
      opts.apiMock.mockReturnValue(pending.promise);
      const client = createTestQueryClient();
      seed(client);
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapper(client),
      });

      act(() => {
        mutation.result.current.mutate('kb1');
      });

      await waitFor(() =>
        expect(
          client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1')),
        ).toMatchObject(opts.after),
      );
      expect(firstListItem(client, unfilteredListKey())).toMatchObject(
        opts.after,
      );

      await act(async () => {
        pending.resolve({ likeCount: 9, isLiked: opts.after.isLiked });
      });

      await waitFor(() =>
        expect(
          client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1')),
        ).toMatchObject({ likeCount: 9, isLiked: opts.after.isLiked }),
      );
      expect(firstListItem(client, unfilteredListKey())?.likeCount).toBe(9);
      expect(invalidate).not.toHaveBeenCalled();
      expect(opts.apiMock).toHaveBeenCalledWith('kb1');
    });

    it('失败时回滚详情与列表', async () => {
      opts.apiMock.mockRejectedValue(new Error('boom'));
      const client = createTestQueryClient();
      seed(client);
      const mutation = renderHook(() => opts.useHook(), {
        wrapper: createWrapper(client),
      });

      await act(async () => {
        await expect(
          mutation.result.current.mutateAsync('kb1'),
        ).rejects.toThrow('boom');
      });

      expect(
        client.getQueryData<KnowledgeBase>(knowledgeKeys.base('kb1')),
      ).toMatchObject(opts.before);
      expect(firstListItem(client, unfilteredListKey())).toMatchObject(
        opts.before,
      );
    });
  });
}

describeLikeMutationTests({
  name: 'useLikeKnowledgeBase',
  useHook: useLikeKnowledgeBase,
  apiMock: api.likeKnowledgeBaseApi,
  before: { likeCount: 2, isLiked: false },
  after: { likeCount: 3, isLiked: true },
});

describeLikeMutationTests({
  name: 'useUnlikeKnowledgeBase',
  useHook: useUnlikeKnowledgeBase,
  apiMock: api.unlikeKnowledgeBaseApi,
  before: { likeCount: 3, isLiked: true },
  after: { likeCount: 2, isLiked: false },
});

describe('useDocumentList', () => {
  it('kbId 为空时禁用请求', () => {
    const { result } = renderHook(() => useDocumentList(undefined, {}), {
      wrapper: createWrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(api.listDocumentsApi).not.toHaveBeenCalled();
  });

  it('按页码请求并返回 total；分页参数进 queryKey（换页不命中上一页缓存）', async () => {
    api.listDocumentsApi.mockResolvedValue({
      list: [makeDocListItem()],
      total: 42,
      page: 2,
      pageSize: 20,
    });
    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useDocumentList('kb1', { page: 2, pageSize: 20, keyword: 'x' }),
      { wrapper: createWrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.listDocumentsApi).toHaveBeenCalledWith('kb1', {
      page: 2,
      pageSize: 20,
      keyword: 'x',
    });
    expect(result.current.data?.total).toBe(42);
    expect(
      client.getQueryData(
        knowledgeKeys.documentList('kb1', { page: 1, pageSize: 20 }),
      ),
    ).toBeUndefined();
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
      wrapper: createWrapper(client),
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
      wrapper: createWrapper(client),
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
