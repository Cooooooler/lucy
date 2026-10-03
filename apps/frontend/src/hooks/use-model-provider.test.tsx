import type { ModelProvider } from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_PROVIDER_PAGE_SIZE,
  modelProviderKeys,
  useCreateModelProvider,
  useDeleteModelProvider,
  useInfiniteModelProviderList,
  useTestModelProviderConnection,
  useUpdateModelProvider,
} from './use-model-provider.js';

const api = vi.hoisted(() => ({
  listModelProvidersApi: vi.fn(),
  createModelProviderApi: vi.fn(),
  updateModelProviderApi: vi.fn(),
  deleteModelProviderApi: vi.fn(),
  testModelProviderConnectionApi: vi.fn(),
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

function infiniteCache<T>(
  pages: Array<{ list: T[]; nextCursor: string | null }>,
) {
  return { pages, pageParams: pages.map((_, i) => (i === 0 ? null : `c${i}`)) };
}

function createWrapperWithClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** 从无限列表缓存里取某一页的 list */
function listOf(client: QueryClient, query: Record<string, unknown>) {
  const data = client.getQueryData<{ pages: { list: ModelProvider[] }[] }>(
    modelProviderKeys.list(query),
  );
  return data?.pages.flatMap((p) => p.list) ?? [];
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
      { wrapper: createWrapperWithClient(client) },
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

  it('create 成功后把新模型插入匹配过滤条件的列表首页', async () => {
    const created = makeModel({ id: 'm-new', name: 'new-model' });
    api.createModelProviderApi.mockResolvedValue(created);
    const client = createTestQueryClient();
    // 至少要有一页（空页也可）作为插入目标：无页的无限缓存会被 prepend 直接跳过
    client.setQueryData(
      modelProviderKeys.list({ limit: 20 }),
      infiniteCache([{ list: [], nextCursor: null }]),
    );

    const { result } = renderHook(() => useCreateModelProvider(), {
      wrapper: createWrapperWithClient(client),
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

    expect(listOf(client, { limit: 20 }).map((m) => m.id)).toContain('m-new');
  });

  it('update 乐观更新且绝不把明文 apiKey 写入缓存', async () => {
    const existing = makeModel();
    const updated = makeModel({
      name: 'renamed',
      updatedAt: '2024-02-02T00:00:00Z',
    });
    api.updateModelProviderApi.mockResolvedValue(updated);
    const client = createTestQueryClient();
    client.setQueryData(
      modelProviderKeys.list({ limit: 20 }),
      infiniteCache([{ list: [existing], nextCursor: null }]),
    );
    client.setQueryData(modelProviderKeys.item('m1'), existing);

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'm1',
        input: { name: 'renamed', apiKey: 'sk-plaintext-secret' },
      });
    });

    const item = client.getQueryData<ModelProvider>(
      modelProviderKeys.item('m1'),
    );
    expect(item?.name).toBe('renamed');
    // 明文 API Key 绝不能进入缓存
    expect(JSON.stringify(item)).not.toContain('sk-plaintext-secret');
    expect(item).not.toHaveProperty('apiKey');
  });

  it('update 失败回滚', async () => {
    const existing = makeModel();
    api.updateModelProviderApi.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    client.setQueryData(modelProviderKeys.item('m1'), existing);

    const { result } = renderHook(() => useUpdateModelProvider(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current
        .mutateAsync({ id: 'm1', input: { name: 'changed' } })
        .catch(() => undefined);
    });

    expect(
      client.getQueryData<ModelProvider>(modelProviderKeys.item('m1'))?.name,
    ).toBe('gpt-4o-mini');
  });

  it('delete 成功后从列表与详情缓存移除', async () => {
    const existing = makeModel();
    api.deleteModelProviderApi.mockResolvedValue(null);
    const client = createTestQueryClient();
    client.setQueryData(
      modelProviderKeys.list({ limit: 20 }),
      infiniteCache([{ list: [existing], nextCursor: null }]),
    );
    client.setQueryData(modelProviderKeys.item('m1'), existing);

    const { result } = renderHook(() => useDeleteModelProvider(), {
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync('m1');
    });

    expect(listOf(client, { limit: 20 })).toEqual([]);
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
      wrapper: createWrapperWithClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync('m1');
    });
    expect(api.testModelProviderConnectionApi).toHaveBeenCalledWith('m1');
  });
});
