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

/**
 * 本地 message.success 的调用 spy：路由不再自己弹成功提示（改由后端 message
 * 经全局桥弹出），把 useApp 的 message 换成可观测对象即能断言「未调用」——
 * 若有人把 message.success 加回生产代码，这些用例会失败。modal 等其余透传真实值。
 */
const messageSuccess = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const mod = await importOriginal<typeof import('antd')>();
  const useApp = () => {
    const real = mod.App.useApp();
    return { ...real, message: { ...real.message, success: messageSuccess } };
  };
  return { ...mod, App: { ...mod.App, useApp } };
});

/**
 * 四个写操作由路由持有一份（卡片只上报意图）：这里用可控的 mutation stub
 * 替换 hook，断言「意图 → 调用哪个 mutation / 参数 / 反馈提示 / pending 透传」。
 */
const mutationMocks = vi.hoisted(() => {
  const makeMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    variables: undefined as unknown,
  });
  return {
    create: makeMutation(),
    update: makeMutation(),
    like: makeMutation(),
    unlike: makeMutation(),
    delete: makeMutation(),
  };
});

vi.mock('@/hooks/use-knowledge', () => ({
  useInfiniteKnowledgeBaseList: vi.fn(),
  useCreateKnowledgeBase: vi.fn(() => mutationMocks.create),
  useUpdateKnowledgeBase: vi.fn(() => mutationMocks.update),
  useLikeKnowledgeBase: vi.fn(() => mutationMocks.like),
  useUnlikeKnowledgeBase: vi.fn(() => mutationMocks.unlike),
  useDeleteKnowledgeBase: vi.fn(() => mutationMocks.delete),
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
    isPlaceholderData: false,
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

/** 取路由传下去的某个事件处理器 */
function gridHandler(name: string) {
  return lastGridProps()[name] as (kb: KnowledgeBase) => unknown;
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
    for (const mutation of Object.values(mutationMocks)) {
      mutation.isPending = false;
      mutation.variables = undefined;
    }
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

  it('把 isPlaceholderData 透传给网格（换筛选时列表保持可见，不换骨架）', () => {
    mockedList.mockReturnValue({
      ...noopQuery(),
      isPlaceholderData: true,
    } as unknown as ReturnType<typeof useInfiniteKnowledgeBaseList>);

    renderRoute();

    expect(lastGridProps().isPlaceholderData).toBe(true);
  });

  it('点击「新增知识库」打开单例表单抽屉', async () => {
    renderRoute();

    await userEvent.click(screen.getByText('新增知识库'));

    expect(await screen.findByLabelText('名称')).toBeInTheDocument();
    expect(screen.getByLabelText('描述')).toBeInTheDocument();
  });

  it('网格 onEdit 打开编辑抽屉并预填该卡片', async () => {
    renderRoute();
    const onEdit = gridHandler('onEdit');
    const kb = makeKb('kb9', '架构文档');

    act(() => onEdit(kb));

    expect(await screen.findByDisplayValue('架构文档')).toBeInTheDocument();
    expect(screen.getByDisplayValue('架构文档 的描述')).toBeInTheDocument();
  });

  it('未点赞的卡片上报点赞 → 调用 like.mutate', () => {
    renderRoute();
    const kb = makeKb('kb1', '产品文档');

    act(() => gridHandler('onToggleLike')(kb));

    expect(mutationMocks.like.mutate).toHaveBeenCalledWith('kb1');
    expect(mutationMocks.unlike.mutate).not.toHaveBeenCalled();
  });

  it('已点赞的卡片上报点赞 → 调用 unlike.mutate', () => {
    renderRoute();
    const kb = { ...makeKb('kb1', '产品文档'), isLiked: true, likeCount: 3 };

    act(() => gridHandler('onToggleLike')(kb));

    expect(mutationMocks.unlike.mutate).toHaveBeenCalledWith('kb1');
    expect(mutationMocks.like.mutate).not.toHaveBeenCalled();
  });

  it('切换可见性：调用 update；成功提示由后端 message 经全局桥弹出（路由不再自己弹）', async () => {
    renderRoute();
    const kb = makeKb('kb1', '产品文档');

    await act(async () => {
      await gridHandler('onToggleVisibility')(kb);
    });

    expect(mutationMocks.update.mutateAsync).toHaveBeenCalledWith({
      id: 'kb1',
      input: { visibility: 'public' },
    });
    // 可失败的「不再自己弹」：本地 message.success 一旦被调用即失败
    expect(messageSuccess).not.toHaveBeenCalled();
  });

  it('切换可见性失败：提示服务端返回的 message', async () => {
    // 模拟 hook-fetch 克隆后的错误：类身份丢失（instanceof ApiError 为 false），
    // 只剩 message/name/status 等字段——按字段取值才能把后端原因展示出来
    const error = Object.assign(new Error('仅知识库主可操作'), {
      name: 'ApiError',
      status: 403,
    });
    mutationMocks.update.mutateAsync.mockRejectedValueOnce(error);
    renderRoute();

    await act(async () => {
      await gridHandler('onToggleVisibility')(makeKb('kb1', '产品文档'));
    });

    expect(await screen.findByText('仅知识库主可操作')).toBeInTheDocument();
  });

  it('切换可见性遇到技术性错误：走兜底文案（不把底层报错抛给用户）', async () => {
    mutationMocks.update.mutateAsync.mockRejectedValueOnce(
      new Error('Failed to fetch'),
    );
    renderRoute();

    await act(async () => {
      await gridHandler('onToggleVisibility')(makeKb('kb1', '产品文档'));
    });

    expect(await screen.findByText('操作失败，请稍后重试')).toBeInTheDocument();
  });

  it('删除：先弹确认框，确认后才调用删除接口；成功提示由全局桥弹出（路由不再自己弹）', async () => {
    renderRoute();

    await act(async () => {
      gridHandler('onDelete')(makeKb('kb1', '产品文档'));
    });

    expect(
      screen.getByText('确定要删除知识库「产品文档」吗？此操作不可恢复。'),
    ).toBeInTheDocument();
    expect(mutationMocks.delete.mutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() =>
      expect(mutationMocks.delete.mutateAsync).toHaveBeenCalledWith('kb1'),
    );
    // 可失败的「不再自己弹」：本地 message.success 一旦被调用即失败
    expect(messageSuccess).not.toHaveBeenCalled();
  });

  it('删除确认框取消时不调用接口', async () => {
    renderRoute();

    await act(async () => {
      gridHandler('onDelete')(makeKb('kb1', '产品文档'));
    });
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    expect(mutationMocks.delete.mutateAsync).not.toHaveBeenCalled();
  });

  it('把 mutation 的 pending 态整理成 pendingIds 传给网格', () => {
    mutationMocks.like.isPending = true;
    mutationMocks.like.variables = 'kb7';
    mutationMocks.delete.isPending = true;
    mutationMocks.delete.variables = 'kb8';

    renderRoute();

    expect(lastGridProps().pendingIds).toEqual({
      like: 'kb7',
      update: null,
      delete: 'kb8',
    });
  });

  it('update 的 pending 态取 variables.id（该 mutation 的入参是对象）', () => {
    mutationMocks.update.isPending = true;
    mutationMocks.update.variables = {
      id: 'kb9',
      input: { name: 'x' },
    };

    renderRoute();

    expect(lastGridProps().pendingIds).toMatchObject({ update: 'kb9' });
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

  it('恢复完成后消费掉锚点：网格卸载重挂不再回放旧位置', async () => {
    mockViewState({}, 7);
    renderRoute();
    expect(lastGridProps().initialRestoreIndex).toBe(7);

    const onRestoreDone = lastGridProps().onRestoreDone as () => void;
    act(() => onRestoreDone());
    await waitFor(() => expect(lastGridProps().initialRestoreIndex).toBe(0));

    // 改筛选 → 锚点已是 0，不会覆盖回顶
    await userEvent.click(screen.getByText('公开'));
    expect(lastGridProps().initialRestoreIndex).toBe(0);
  });

  it('改筛选即作废锚点：网格从未挂载（骨架/空态）时旧锚点不会被回放到新列表', async () => {
    mockViewState({}, 7);
    renderRoute();
    expect(lastGridProps().initialRestoreIndex).toBe(7);

    // 网格一直没挂载 → onRestoreDone 从未回调 → 锚点仍是 7；
    // 此时改筛选必须直接作废它，否则新条件的数据回来后会被恢复到旧位置
    await userEvent.click(screen.getByText('公开'));

    expect(lastGridProps().initialRestoreIndex).toBe(0);
  });

  it('清空搜索同样作废锚点', async () => {
    mockViewState({ name: '产品' }, 5);
    renderRoute();

    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    expect(lastGridProps().initialRestoreIndex).toBe(0);
  });

  it('onEdit 引用稳定（useCallback）：重渲染后仍是同一引用', async () => {
    mockViewState();
    renderRoute();
    const before = lastGridProps().onEdit;

    // 触发一次重渲染（切换可见性筛选）
    await userEvent.click(screen.getByText('公开'));

    expect(lastGridProps().onEdit).toBe(before);
    expect(before).toEqual(expect.any(Function));
  });
});
