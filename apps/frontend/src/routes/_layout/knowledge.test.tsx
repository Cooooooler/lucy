import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as KnowledgeRoute } from './knowledge';

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledgeBaseList: (query: unknown) => listMock(query),
  useCreateKnowledgeBase: () => ({
    mutateAsync: createMock,
    isPending: false,
  }),
  useUpdateKnowledgeBase: () => ({
    mutateAsync: updateMock,
    isPending: false,
  }),
  useDeleteKnowledgeBase: () => ({
    mutateAsync: removeMock,
    isPending: false,
  }),
}));

function renderKnowledge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const C = KnowledgeRoute.options.component as FC;
  return render(
    <QueryClientProvider client={queryClient}>
      <AntdApp>
        <C />
      </AntdApp>
    </QueryClientProvider>,
  );
}

const kb = {
  id: 'kb1',
  ownerId: 'u1',
  visibility: 'private' as const,
  name: '产品文档',
  description: 'lorem',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('routes/_layout/knowledge', () => {
  beforeEach(() => {
    listMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    createMock.mockResolvedValue(undefined);
    updateMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('error 且无缓存时渲染 KnowledgeGridError（重试可点击且仅调一次 refetch）', async () => {
    const refetch = vi.fn();
    listMock.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }));
    renderKnowledge();
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    const retryBtn = buttons.find(
      (b) => b.textContent?.replace(/\s+/g, '') === '重试',
    );
    expect(retryBtn).toBeDefined();
    fireEvent.click(retryBtn!);
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('error 但有缓存数据时不盖掉列表（分支保护）', () => {
    listMock.mockReturnValue({
      data: { list: [kb], total: 1, page: 1, pageSize: 20 },
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderKnowledge();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
    expect(screen.queryByText('加载失败')).toBeNull();
  });

  it('空列表时按 keyword 文案显示 Empty', () => {
    listMock.mockReturnValue({
      data: { list: [], total: 0, page: 1, pageSize: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderKnowledge();
    expect(
      screen.getByText('还没有知识库，点击右上角新建'),
    ).toBeInTheDocument();
  });

  it('非空列表渲染卡片 + 搜索防抖走 name 参数', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockReturnValue({
      data: { list: [kb], total: 1, page: 1, pageSize: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderKnowledge();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
    expect(screen.getByText('私有')).toBeInTheDocument();

    const input = screen.getByPlaceholderText('搜索名称') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '产品' } });
    // 防抖 300ms 后把 keyword 同步到 listQuery.name
    vi.advanceTimersByTime(350);
    await waitFor(() => {
      const last = listMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(last.name).toBe('产品');
    });
    vi.useRealTimers();
  });

  it('导出 Route 组件不抛错（渲染根节点）', () => {
    expect(() => renderKnowledge()).not.toThrow();
  });
});
