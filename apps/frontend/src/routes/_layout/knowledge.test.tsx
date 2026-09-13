import type { KnowledgeBase } from '@/api/types.ts';
import { KnowledgeGrid } from '@/components/knowledge/KnowledgeGrid.tsx';
import { makeKb } from '@/components/knowledge/knowledge-test-fixture.ts';
import { useInfiniteKnowledgeBaseList } from '@/hooks/use-knowledge';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as KnowledgeRoute } from './knowledge';

vi.mock('@/hooks/use-knowledge', () => ({
  useInfiniteKnowledgeBaseList: vi.fn(),
  useCreateKnowledgeBase: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useUpdateKnowledgeBase: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useLikeKnowledgeBase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnlikeKnowledgeBase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteKnowledgeBase: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/components/knowledge/KnowledgeGrid.tsx', () => ({
  KnowledgeGrid: vi.fn(() => null),
}));

vi.mock('@/hooks/use-knowledge-view-state', () => ({
  useKnowledgeViewState: vi.fn(),
}));

const mockedList = vi.mocked(useInfiniteKnowledgeBaseList);
const mockedGrid = vi.mocked(KnowledgeGrid);
const mockedViewState = vi.mocked(useKnowledgeViewState);

function noopQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteKnowledgeBaseList>;
}

/** 控制 store 的冻结值，返回写回 spy 以便断言 */
function mockViewState(
  initialFilter: { name?: string; visibility?: 'private' | 'public' } = {},
  initialRestoreIndex = 0,
) {
  const saveFilter = vi.fn();
  const saveFirstVisibleIndex = vi.fn();
  mockedViewState.mockReturnValue({
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  });
  return { saveFilter, saveFirstVisibleIndex };
}

function renderRoute() {
  const C = KnowledgeRoute.options.component as FC;
  return render(
    <AntdApp>
      <C />
    </AntdApp>,
  );
}

/** 最近一次传给 KnowledgeGrid 的 props（React 可能以 (props, context) 调用） */
function lastGridProps() {
  return mockedGrid.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

/** 点击 Input.Search 的搜索按钮（antd 会把按钮文字渲染成带空格的「搜 索」） */
async function submitSearch(value: string) {
  await userEvent.type(screen.getByPlaceholderText('按名称搜索知识库'), value);
  const searchButton = screen
    .getAllByRole('button')
    .find((b) => b.querySelector('[aria-label="search"]'));
  if (!searchButton) throw new Error('未找到搜索按钮');
  await userEvent.click(searchButton);
}

describe('routes/_layout/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockReturnValue(noopQuery());
    mockedGrid.mockReturnValue(null);
    // vi.clearAllMocks 只清调用历史，不清实现；补默认值避免上个用例的 mockReturnValue 残留
    mockViewState();
  });

  it('用 store 中冻结的筛选与恢复索引初始化（返回恢复的入口）', () => {
    const { saveFirstVisibleIndex } = mockViewState(
      { name: '产品', visibility: 'private' },
      7,
    );

    renderRoute();

    expect(mockedList).toHaveBeenLastCalledWith({
      name: '产品',
      visibility: 'private',
    });
    expect(screen.getByPlaceholderText('按名称搜索知识库')).toHaveValue('产品');
    expect(lastGridProps()).toMatchObject({
      initialRestoreIndex: 7,
      onFirstVisibleItemChange: saveFirstVisibleIndex,
      onEdit: expect.any(Function),
      hasFilter: true,
    });
  });

  it('点击「新增知识库」打开单例表单抽屉', async () => {
    renderRoute();

    await userEvent.click(screen.getByText('新增知识库'));

    expect(await screen.findByLabelText('名称')).toBeInTheDocument();
    expect(screen.getByLabelText('描述')).toBeInTheDocument();
  });

  it('网格 onEdit 打开编辑抽屉并预填该卡片', async () => {
    renderRoute();
    const onEdit = lastGridProps().onEdit as (kb: KnowledgeBase) => void;
    const kb = makeKb('kb9', '架构文档');

    act(() => onEdit(kb));

    expect(await screen.findByDisplayValue('架构文档')).toBeInTheDocument();
    expect(screen.getByDisplayValue('架构文档 的描述')).toBeInTheDocument();
  });

  it('改变筛选时把新筛选写回 store', async () => {
    const { saveFilter } = mockViewState();
    renderRoute();

    await submitSearch('产品');
    expect(saveFilter).toHaveBeenCalledWith({ name: '产品' });

    await userEvent.click(screen.getByText('公开'));
    expect(saveFilter).toHaveBeenCalledWith({ visibility: 'public' });
  });

  it('清空筛选时写回 undefined（空关键词 / 全部）', async () => {
    const { saveFilter } = mockViewState({ name: '产品' });
    renderRoute();

    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(saveFilter).toHaveBeenCalledWith({ name: undefined });

    await userEvent.click(screen.getByText('公开'));
    await userEvent.click(screen.getByText('全部'));
    expect(saveFilter).toHaveBeenLastCalledWith({ visibility: undefined });
  });

  it('挂载不归零，改筛选才回到列表顶部', async () => {
    mockViewState();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    try {
      renderRoute();

      expect(scrollTo).not.toHaveBeenCalled();

      await userEvent.click(screen.getByText('公开'));
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
    } finally {
      scrollTo.mockRestore();
    }
  });

  it('onEdit 引用稳定（useCallback）：重渲染后仍是同一引用，保证卡片 React.memo 生效', async () => {
    mockViewState();
    renderRoute();
    const before = lastGridProps().onEdit;

    // 触发一次重渲染（切换可见性筛选）
    await userEvent.click(screen.getByText('公开'));

    expect(lastGridProps().onEdit).toBe(before);
    expect(before).toEqual(expect.any(Function));
  });
});
