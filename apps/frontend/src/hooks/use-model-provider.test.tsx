import type { ModelProvider } from '@/api/types';
import {
  createTestQueryClient,
  createQueryWrapper as createWrapper,
} from '@/test/query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_PROVIDER_PAGE_SIZE,
  modelProviderKeys,
  useCreateModelProvider,
  useDeleteModelProvider,
  useInfiniteModelProviderList,
  useLlmModelProviders,
  useModelProvider,
  useModelProviderDefaults,
  useModelProvidersByType,
  useRefreshModelProviderList,
  useTestModelProviderConnection,
  useUpdateModelProvider,
  useUpdateModelProviderDefaults,
} from './use-model-provider.js';

const api = vi.hoisted(() => ({
  listModelProvidersApi: vi.fn(),
  createModelProviderApi: vi.fn(),
  updateModelProviderApi: vi.fn(),
  deleteModelProviderApi: vi.fn(),
  testModelProviderConnectionApi: vi.fn(),
  getModelProviderApi: vi.fn(),
  getModelProviderDefaultsApi: vi.fn(),
  updateModelProviderDefaultsApi: vi.fn(),
}));

vi.mock('@/api/model-provider', () => api);

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

function cursorPage<T>(list: T[], nextCursor: string | null = null) {
  return { list, nextCursor };
}

describe('use-model-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useInfiniteModelProviderList 透传过滤条件与每页条数', async () => {
    api.listModelProvidersApi.mockResolvedValue(
      cursorPage([makeModel()], null),
    );
    const client = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteModelProviderList({ name: 'gpt', type: 'llm' }),
      { wrapper: createWrapper(client) },
    );

    await waitFor(() =>
      expect(result.current.data?.pages[0].list).toHaveLength(1),
    );
    expect(api.listModelProvidersApi).toHaveBeenCalledWith({
      name: 'gpt',
      type: 'llm',
      limit: MODEL_PROVIDER_PAGE_SIZE,
      cursor: undefined,
    });
  });

  it('换筛选后切回在 staleTime 内复用缓存，不再请求', async () => {
    // staleTime 为 3 分钟：切回已看过的筛选直接复用缓存，不重放已加载分页
    api.listModelProvidersApi.mockImplementation(
      (query: { type?: string; cursor?: string } = {}) => {
        if (query.type === 'llm') {
          return Promise.resolve(cursorPage([makeModel({ id: 'llm1' })], null));
        }
        return Promise.resolve(
          query.cursor
            ? cursorPage([makeModel({ id: 'all2' })], null)
            : cursorPage([makeModel({ id: 'all1' })], 'c1'),
        );
      },
    );
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(
      (props: { type?: ModelProvider['type'] }) =>
        useInfiniteModelProviderList(props),
      { wrapper: createWrapper(client), initialProps: {} },
    );

    // 全部：先加载两页
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listModelProvidersApi).toHaveBeenCalledTimes(2);

    // 切到 LLM：新条件正常请求一次
    rerender({ type: 'llm' });
    await waitFor(() =>
      expect(api.listModelProvidersApi).toHaveBeenCalledTimes(3),
    );
    expect(result.current.isPlaceholderData).toBe(false);

    // 切回「全部」：缓存仍在 staleTime 内，直接复用两页，不再请求
    rerender({});
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(api.listModelProvidersApi).toHaveBeenCalledTimes(3);
    expect(
      client.getQueryCache().findAll({ queryKey: modelProviderKeys.listAll() }),
    ).toHaveLength(2);
  });

  it('useRefreshModelProviderList 丢弃全部列表缓存并重新加载', async () => {
    api.listModelProvidersApi.mockResolvedValue(
      cursorPage([makeModel()], null),
    );
    const client = createTestQueryClient();
    const wrapper = createWrapper(client);
    const { result } = renderHook(() => useInfiniteModelProviderList({}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const { result: refresh } = renderHook(
      () => useRefreshModelProviderList(),
      { wrapper },
    );
    await act(async () => {
      await refresh.current();
    });

    expect(api.listModelProvidersApi).toHaveBeenCalledTimes(2);
  });

  it('create 成功后按「刷新」处理：resetQueries 从第一页重取', async () => {
    const created = makeModel({ id: 'm-new', name: 'new-model' });
    api.createModelProviderApi.mockResolvedValue(created);
    const client = createTestQueryClient();
    const reset = vi.spyOn(client, 'resetQueries');

    const { result } = renderHook(() => useCreateModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        name: 'new-model',
        type: 'llm',
        vendor: 'openai',
        baseUrl: 'https://x/v1',
        contextLength: 1,
        apiKey: 'sk-1',
      });
    });

    expect(api.createModelProviderApi).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({
        queryKey: modelProviderKeys.listAll(),
      }),
    );
  });

  it('update 乐观改写详情与列表，且不写入明文 apiKey', async () => {
    const existing = makeModel();
    const listKey = modelProviderKeys.list({
      limit: MODEL_PROVIDER_PAGE_SIZE,
    });
    api.updateModelProviderApi.mockResolvedValue(
      makeModel({ name: 'renamed' }),
    );
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);
    client.setQueryData(listKey, {
      pages: [{ list: [existing], nextCursor: null }],
      pageParams: [null],
    });

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'm1',
        input: { name: 'renamed', apiKey: 'sk-plaintext-secret' },
      });
    });

    // 成功后用服务端值收敛详情与列表
    expect(
      client.getQueryData<ModelProvider>(modelProviderKeys.item('m1'))?.name,
    ).toBe('renamed');
    expect(
      client.getQueryData<{ pages: { list: ModelProvider[] }[] }>(listKey)
        ?.pages[0].list[0]?.name,
    ).toBe('renamed');
    // 明文 API Key 绝不能进入缓存
    expect(
      JSON.stringify(client.getQueryData(modelProviderKeys.item('m1'))),
    ).not.toContain('sk-plaintext-secret');
    expect(JSON.stringify(client.getQueryData(listKey))).not.toContain(
      'sk-plaintext-secret',
    );
  });

  it('update 在请求返回前就改写缓存（乐观）', async () => {
    const existing = makeModel();
    let resolveUpdate: (value: ModelProvider) => void = () => {};
    api.updateModelProviderApi.mockImplementation(
      () =>
        new Promise<ModelProvider>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapper(client),
    });
    let pending: Promise<ModelProvider>;
    act(() => {
      pending = result.current.mutateAsync({
        id: 'm1',
        input: { name: 'renamed' },
      });
    });

    await waitFor(() =>
      expect(
        client.getQueryData<ModelProvider>(modelProviderKeys.item('m1'))?.name,
      ).toBe('renamed'),
    );

    await act(async () => {
      resolveUpdate(makeModel({ name: 'renamed' }));
      await pending;
    });
  });

  it('update 改名后不再满足当前筛选：列表里的条目立即移除', async () => {
    const existing = makeModel({ name: 'gpt-4o-mini' });
    const listKey = modelProviderKeys.list({ name: 'gpt' });
    api.updateModelProviderApi.mockResolvedValue(
      makeModel({ name: 'claude-x' }),
    );
    const client = createTestQueryClient();
    client.setQueryData(listKey, {
      pages: [{ list: [existing], nextCursor: null }],
      pageParams: [null],
    });

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'm1',
        input: { name: 'claude-x' },
      });
    });

    expect(
      client.getQueryData<{ pages: { list: ModelProvider[] }[] }>(listKey)
        ?.pages[0].list,
    ).toHaveLength(0);
  });

  it('update 失败时回滚并失效列表与详情', async () => {
    const existing = makeModel();
    const listKey = modelProviderKeys.list({
      limit: MODEL_PROVIDER_PAGE_SIZE,
    });
    api.updateModelProviderApi.mockRejectedValue(new Error('boom'));
    api.listModelProvidersApi.mockResolvedValue(cursorPage([existing], null));
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);
    client.setQueryData(listKey, {
      pages: [{ list: [existing], nextCursor: null }],
      pageParams: [null],
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'm1', input: { name: 'nope' } }),
      ).rejects.toThrow('boom');
    });

    expect(
      client.getQueryData<ModelProvider>(modelProviderKeys.item('m1'))?.name,
    ).toBe('gpt-4o-mini');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: modelProviderKeys.listAll(),
    });
  });

  it('delete 乐观移除列表条目，成功后清详情缓存', async () => {
    const existing = makeModel();
    const listKey = modelProviderKeys.list({
      limit: MODEL_PROVIDER_PAGE_SIZE,
    });
    api.deleteModelProviderApi.mockResolvedValue(null);
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);
    client.setQueryData(listKey, {
      pages: [{ list: [existing], nextCursor: null }],
      pageParams: [null],
    });

    const { result } = renderHook(() => useDeleteModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync('m1');
    });

    expect(
      client.getQueryData<{ pages: { list: ModelProvider[] }[] }>(listKey)
        ?.pages[0].list,
    ).toHaveLength(0);
    expect(client.getQueryData(modelProviderKeys.item('m1'))).toBeUndefined();
  });

  it('delete 失败时把条目放回列表并失效', async () => {
    const existing = makeModel();
    const listKey = modelProviderKeys.list({
      limit: MODEL_PROVIDER_PAGE_SIZE,
    });
    api.deleteModelProviderApi.mockRejectedValue(new Error('boom'));
    api.listModelProvidersApi.mockResolvedValue(cursorPage([existing], null));
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);
    client.setQueryData(listKey, {
      pages: [{ list: [existing], nextCursor: null }],
      pageParams: [null],
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteModelProvider(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await expect(result.current.mutateAsync('m1')).rejects.toThrow('boom');
    });

    expect(
      client.getQueryData<{ pages: { list: ModelProvider[] }[] }>(listKey)
        ?.pages[0].list,
    ).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: modelProviderKeys.listAll(),
    });
  });

  it('useTestModelProviderConnection 以 id 调用接口', async () => {
    api.testModelProviderConnectionApi.mockResolvedValue({
      ok: true,
      message: '连接成功',
      latencyMs: 10,
      detail: null,
    });
    const client = createTestQueryClient();
    const { result } = renderHook(() => useTestModelProviderConnection(), {
      wrapper: createWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync('m1');
    });
    expect(api.testModelProviderConnectionApi).toHaveBeenCalledWith('m1');
  });

  it('useModelProvidersByType 取该类型的全部模型', async () => {
    api.listModelProvidersApi.mockResolvedValue(
      cursorPage([makeModel()], null),
    );
    const client = createTestQueryClient();
    const { result } = renderHook(() => useModelProvidersByType('llm'), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.models).toHaveLength(1));
    expect(api.listModelProvidersApi).toHaveBeenCalledWith({
      type: 'llm',
      limit: 100,
      cursor: undefined,
    });
  });

  it('useModelProvider 按 id 取详情；id 为空时不请求', async () => {
    const model = makeModel();
    api.getModelProviderApi.mockResolvedValue(model);
    const client = createTestQueryClient();
    const wrapper = createWrapper(client);

    const { result } = renderHook(() => useModelProvider('m1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(model));
    expect(api.getModelProviderApi).toHaveBeenCalledWith('m1');
    // 与列表/乐观更新共用 item key
    expect(client.getQueryData(modelProviderKeys.item('m1'))).toEqual(model);

    api.getModelProviderApi.mockClear();
    renderHook(() => useModelProvider(undefined), { wrapper });
    expect(api.getModelProviderApi).not.toHaveBeenCalled();
  });

  it('useLlmModelProviders 只取 llm 模型，且 models 引用在不同渲染间保持稳定', async () => {
    api.listModelProvidersApi.mockResolvedValue(
      cursorPage([makeModel()], null),
    );
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(() => useLlmModelProviders(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.models).toHaveLength(1));
    expect(api.listModelProvidersApi).toHaveBeenCalledWith({
      type: 'llm',
      limit: 100,
      cursor: undefined,
    });

    // 数据未变时重渲染不重建 models：下游据此记忆化的菜单项才不会每次重算
    const first = result.current.models;
    rerender();
    expect(result.current.models).toBe(first);
  });

  it('useModelProviderDefaults 在 enabled=false 时不请求', () => {
    const client = createTestQueryClient();
    renderHook(() => useModelProviderDefaults(false), {
      wrapper: createWrapper(client),
    });
    expect(api.getModelProviderDefaultsApi).not.toHaveBeenCalled();
  });

  it('useUpdateModelProviderDefaults 成功后写回默认模型缓存', async () => {
    const data = {
      defaults: [{ type: 'llm' as const, modelProviderId: 'm1' }],
    };
    api.updateModelProviderDefaultsApi.mockResolvedValue(data);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useUpdateModelProviderDefaults(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        defaults: [{ type: 'llm', modelProviderId: 'm1' }],
      });
    });

    expect(api.updateModelProviderDefaultsApi.mock.calls[0]?.[0]).toEqual({
      defaults: [{ type: 'llm', modelProviderId: 'm1' }],
    });
    expect(client.getQueryData(modelProviderKeys.defaults())).toEqual(data);
  });
});
