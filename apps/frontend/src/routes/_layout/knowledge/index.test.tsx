import type { KnowledgeBase } from '@/api/types.ts';
import { VirtualCardGrid } from '@/components/card-list/VirtualCardGrid.tsx';
import { makeKb } from '@/components/knowledge/knowledge-test-fixture.ts';
import { useInfiniteKnowledgeBaseList } from '@/hooks/use-knowledge';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { FC, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as KnowledgeRoute } from './index';

/**
 * 卡片热区是路由注入的 `<Link>`：本文件沿用 `routes/_layout.test.tsx` 的约定，
 * 只替换需要的部分（`createFileRoute` 与 `Route.options.component` 保持真实），
 * 把 Link 渲染成裸 `<a>`，从而不必为 22 条用例套一整个 RouterProvider。
 */
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    to,
    params,
    ...rest
  }: {
    to: string;
    params?: { kbId?: string };
  }) => (
    <a href={params?.kbId ? to.replace('$kbId', params.kbId) : to} {...rest} />
  ),
}));

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

/** 刷新回调（丢弃全部列表缓存并重载）：由路由持有的 hook 提供 */
const refreshList = vi.hoisted(() => vi.fn());

// 创建抽屉里的重排模型下拉会按类型取模型列表：列表页用例不需要真实请求
vi.mock('@/hooks/use-model-provider', () => ({
  useModelProvidersByType: vi.fn(() => ({ models: [], isLoading: false })),
}));

vi.mock('@/hooks/use-knowledge', () => ({
  useInfiniteKnowledgeBaseList: vi.fn(),
  useRefreshKnowledgeBaseList: vi.fn(() => refreshList),
  useCreateKnowledgeBase: vi.fn(() => mutationMocks.create),
  useUpdateKnowledgeBase: vi.fn(() => mutationMocks.update),
  useLikeKnowledgeBase: vi.fn(() => mutationMocks.like),
  useUnlikeKnowledgeBase: vi.fn(() => mutationMocks.unlike),
  useDeleteKnowledgeBase: vi.fn(() => mutationMocks.delete),
}));

/**
 * 通用网格的桩：把每条数据都经路由的 `renderItem` 真实渲染出来（不虚拟化）。
 * 这样既保留了「路由往下传了什么」的断言（`mockedGrid.mock.calls`），
 * 又能通过真实卡片上的按钮驱动路由的事件处理器。
 */
type GridStubProps = {
  items: KnowledgeBase[];
  renderItem: (item: KnowledgeBase) => ReactNode;
};

vi.mock('@/components/card-list/VirtualCardGrid.tsx', async () => {
  const { createElement, Fragment } = await import('react');
  return {
    VirtualCardGrid: vi.fn((props: GridStubProps) =>
      createElement(
        Fragment,
        null,
        props.items.map((item) =>
          createElement(Fragment, { key: item.id }, props.renderItem(item)),
        ),
      ),
    ),
  };
});

vi.mock('@/hooks/use-knowledge-view-state', () => ({
  useKnowledgeViewState: vi.fn(),
}));

const mockedList = vi.mocked(useInfiniteKnowledgeBaseList);
const mockedGrid = vi.mocked(VirtualCardGrid);
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

/** 让列表返回指定条目（页面据渲染成真实卡片） */
function mockItems(items: KnowledgeBase[]) {
  mockedList.mockReturnValue({
    ...noopQuery(),
    data: { pages: [{ list: items, nextCursor: null }], pageParams: [null] },
  } as unknown as ReturnType<typeof useInfiniteKnowledgeBaseList>);
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

/** 最近一次传给通用网格的 props（React 可能以 (props, context) 调用） */
function lastGridProps() {
  return mockedGrid.mock.calls.at(-1)?.[0] as unknown as Record<
    string,
    unknown
  >;
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
      hasFilter: true,
      emptyLabel: { filtered: '没有匹配的知识库', initial: '暂无知识库' },
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

  it('卡片的编辑意图打开编辑抽屉并预填该卡片', async () => {
    mockItems([makeKb('kb9', '架构文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(await screen.findByDisplayValue('架构文档')).toBeInTheDocument();
    expect(screen.getByDisplayValue('架构文档 的描述')).toBeInTheDocument();
  });

  it('未点赞的卡片上报点赞 → 调用 like.mutate', async () => {
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '点赞' }));

    expect(mutationMocks.like.mutate).toHaveBeenCalledWith('kb1');
    expect(mutationMocks.unlike.mutate).not.toHaveBeenCalled();
  });

  it('已点赞的卡片上报点赞 → 调用 unlike.mutate', async () => {
    mockItems([{ ...makeKb('kb1', '产品文档'), isLiked: true, likeCount: 3 }]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '取消点赞' }));

    expect(mutationMocks.unlike.mutate).toHaveBeenCalledWith('kb1');
    expect(mutationMocks.like.mutate).not.toHaveBeenCalled();
  });

  it('切换可见性：调用 update；成功提示由后端 message 经全局桥弹出（路由不再自己弹）', async () => {
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    await waitFor(() =>
      expect(mutationMocks.update.mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: { visibility: 'public' },
      }),
    );
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
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    expect(await screen.findByText('仅知识库主可操作')).toBeInTheDocument();
  });

  it('切换可见性遇到技术性错误：走兜底文案（不把底层报错抛给用户）', async () => {
    mutationMocks.update.mutateAsync.mockRejectedValueOnce(
      new Error('Failed to fetch'),
    );
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    expect(await screen.findByText('操作失败，请稍后重试')).toBeInTheDocument();
  });

  it('删除：先弹确认框，确认后才调用删除接口；成功提示由全局桥弹出（路由不再自己弹）', async () => {
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

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
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));
    await userEvent.click(screen.getByRole('button', { name: /取\s*消/ }));

    expect(mutationMocks.delete.mutateAsync).not.toHaveBeenCalled();
  });

  it('把 mutation 的 pending 态落到对应卡片的禁用态（点赞与取消点赞是一对）', () => {
    mutationMocks.like.isPending = true;
    mutationMocks.like.variables = 'kb7';
    mutationMocks.delete.isPending = true;
    mutationMocks.delete.variables = 'kb7';
    mockItems([makeKb('kb7', '产品文档')]);

    renderRoute();

    expect(screen.getByRole('button', { name: '点赞' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeDisabled();
    // 未 pending 的操作不受影响；编辑不涉及写操作，保持可用
    expect(screen.getByRole('button', { name: '设为公开' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '编辑知识库' })).toBeEnabled();
  });

  it('update 的 pending 态取 variables.id（该 mutation 的入参是对象）', () => {
    mutationMocks.update.isPending = true;
    mutationMocks.update.variables = { id: 'kb9', input: { name: 'x' } };
    mockItems([makeKb('kb9', '产品文档')]);

    renderRoute();

    expect(screen.getByRole('button', { name: '设为公开' })).toBeDisabled();
  });

  it('pending 指向别的知识库时当前卡片保持可用', () => {
    mutationMocks.like.isPending = true;
    mutationMocks.like.variables = 'kb7';
    mockItems([makeKb('kb1', '产品文档')]);

    renderRoute();

    expect(screen.getByRole('button', { name: '点赞' })).toBeEnabled();
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

  it('点击刷新：走刷新 hook 重新加载，并回到顶部、作废恢复锚点', async () => {
    mockViewState({}, 7);
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    try {
      renderRoute();
      expect(lastGridProps().initialRestoreIndex).toBe(7);

      await userEvent.click(screen.getByRole('button', { name: '刷新' }));

      await waitFor(() => expect(refreshList).toHaveBeenCalledTimes(1));
      expect(lastGridProps().initialRestoreIndex).toBe(0);
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    } finally {
      scrollTo.mockRestore();
    }
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

  it('renderItem 在筛选条件变化（重渲染）后仍能用最新回调打开抽屉', async () => {
    mockItems([makeKb('kb1', '产品文档')]);
    mockViewState();
    renderRoute();

    // 触发一次重渲染（切换可见性筛选），确认 renderItem 换新引用后卡片依然可用
    await userEvent.click(screen.getByText('公开'));
    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(await screen.findByDisplayValue('产品文档')).toBeInTheDocument();
  });

  it('卡片注入打开热区：指向该知识库详情，且不影响既有操作', () => {
    mockItems([makeKb('kb1', '产品文档')]);
    renderRoute();

    const link = screen.getByRole('link', { name: '打开知识库：产品文档' });
    expect(link).toHaveAttribute('href', '/knowledge/kb1');
    // 热区覆盖整卡（定位类由路由给），角标与操作按钮仍在
    expect(link).toHaveClass('absolute', 'inset-0');
    expect(screen.getByRole('button', { name: '编辑知识库' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeEnabled();
  });
});
