import type { KnowledgeBase } from '@/api/types';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeGrid } from './KnowledgeGrid';
import { makeKb } from './knowledge-test-fixture';

const useVirtualizerMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: useVirtualizerMock,
}));

const virtualizerStub = {
  getVirtualItems: vi.fn(),
  getTotalSize: vi.fn(() => 0),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  /** 恢复路径：返回 [目标 offset, align] */
  getOffsetForIndex: vi.fn(() => [123, 'start'] as const),
  scrollOffset: null as number | null,
};

type GridProps = ComponentProps<typeof KnowledgeGrid>;

/** 宽度可控的滚动容器（jsdom 没有布局盒，clientWidth 恒为 0） */
function makeSizedElement(clientWidth: number): HTMLDivElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', {
    value: clientWidth,
    configurable: true,
  });
  return element;
}

/** 卡片事件回调与 pending 态由路由持有：网格测试只关心透传 */
function cardHandlers() {
  return {
    onToggleLike: vi.fn(),
    onToggleVisibility: vi.fn(),
    onDelete: vi.fn(),
    pendingIds: { like: null, update: null, delete: null },
  };
}

function renderGrid(overrides: Partial<GridProps> = {}) {
  const props: GridProps = {
    scrollElement: null,
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    isPlaceholderData: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    hasFilter: false,
    ...cardHandlers(),
    ...overrides,
  };
  return {
    ...render(
      <AntdApp>
        <KnowledgeGrid {...props} />
      </AntdApp>,
    ),
    props,
  };
}

/** 让虚拟化器认为「索引 0 的卡片可见」 */
function makeFirstItemVisible() {
  virtualizerStub.getVirtualItems.mockReturnValue([
    { index: 0, start: 0, size: 200, lane: 0, key: 0 },
  ]);
}

describe('KnowledgeGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    virtualizerStub.getVirtualItems.mockReturnValue([]);
    virtualizerStub.getTotalSize.mockReturnValue(0);
    virtualizerStub.scrollToIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReturnValue([123, 'start']);
    virtualizerStub.scrollOffset = null;
    useVirtualizerMock.mockReturnValue(virtualizerStub);
  });

  it('加载中渲染 6 个轻量骨架卡片（等高、列宽与真实网格同源）', () => {
    // 给容器一个真实宽度：1000px → computeGridLayout: padding 32、3 列、gap 16
    const { container } = renderGrid({
      isLoading: true,
      scrollElement: makeSizedElement(1000),
    });

    const skeletons = [
      ...container.querySelectorAll('div.animate-pulse'),
    ] as HTMLElement[];
    expect(skeletons).toHaveLength(6);
    // 不再挂 antd Card/Skeleton（本次改造的出发点就是 antd Card 太重）
    expect(container.querySelectorAll('.ant-skeleton')).toHaveLength(0);
    expect(container.querySelectorAll('.ant-card')).toHaveLength(0);
    // 与卡片同一等高约束：否则冷加载完成瞬间会跳高
    for (const skeleton of skeletons) {
      expect(skeleton.style.height).toBe('210px');
      // 列宽只减列间距（gap 16 × 2 = 32px）：容器的 padding 由外层 flex 容器承担，
      // 卡片的 100% 已是内容盒宽度。若再扣一次 2·padding（旧实现的 bug），这里会出现 96px，
      // 每列比真实卡片窄 2·padding/columns、整行右端还会多出空白。
      // （表达式主体的精确形态由 grid-layout.test.ts 钉住，这里只断言「传入的 padding 是 0」。）
      expect(skeleton.style.width).toContain('100%');
      expect(skeleton.style.width).toContain('32px');
      expect(skeleton.style.width).not.toContain('96px');
    }
  });

  it('失败时渲染错误态并可重试（展示服务端业务文案）', async () => {
    // 模拟 hook-fetch 克隆后的错误：只有字段可用（见 api/client.ts 的 errorMessageOf）
    const apiError = Object.assign(new Error('知识库列表加载失败'), {
      name: 'ApiError',
      status: 500,
    });
    const { props } = renderGrid({ isError: true, error: apiError });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('知识库列表加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(props.refetch).toHaveBeenCalledTimes(1);
  });

  it('失败且是技术性错误时走兜底文案（不把英文报错甩给用户）', () => {
    renderGrid({ isError: true, error: new TypeError('Failed to fetch') });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it('空列表且有过滤条件时提示无匹配', () => {
    renderGrid({ hasFilter: true });
    expect(screen.getByText('没有匹配的知识库')).toBeInTheDocument();
  });

  it('空列表且无过滤条件时提示暂无数据', () => {
    renderGrid();
    expect(screen.getByText('暂无知识库')).toBeInTheDocument();
  });

  it('渲染可视窗口内的卡片并在末尾提示已加载全部', () => {
    const items: KnowledgeBase[] = [
      makeKb('kb1', '知识库 A'),
      makeKb('kb2', '知识库 B'),
    ];
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 200, lane: 0, key: 0 },
      { index: 1, start: 200, size: 200, lane: 0, key: 1 },
    ]);
    virtualizerStub.getTotalSize.mockReturnValue(400);
    renderGrid({ items, hasNextPage: false });
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
    expect(screen.getByText('知识库 B')).toBeInTheDocument();
    expect(screen.getByText('已加载全部')).toBeInTheDocument();
  });

  it('卡片宽度与位置交给 CSS calc（拖拽窗口不再逐像素重渲染）', () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    const { container } = renderGrid({ items, hasNextPage: false });

    const wrapper = container.querySelector(
      '[data-index]',
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.width).toContain('calc(');
    expect(wrapper?.style.left).toContain('calc(');
  });

  it('接近末尾时触发预取，且不显示已加载全部', async () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    const { props } = renderGrid({ items, hasNextPage: true });
    await waitFor(() => expect(props.fetchNextPage).toHaveBeenCalled());
    expect(screen.queryByText('已加载全部')).not.toBeInTheDocument();
  });

  it('取下一页失败：页脚就地提示 + 重试，且不再自动重发（不会形成失败重试风暴）', async () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    const { props } = renderGrid({
      items,
      hasNextPage: true,
      isFetchNextPageError: true,
    });

    // 列表仍在（不是整页错误态）
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
    expect(screen.queryByText('加载失败')).toBeInTheDocument();
    expect(screen.queryByText('已加载全部')).not.toBeInTheDocument();
    // hook 侧已闩住：不会因为 isFetchingNextPage 由 true→false 而立刻重发
    expect(props.fetchNextPage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(props.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('加载下一页时显示加载中', () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    renderGrid({ items, hasNextPage: true, isFetchingNextPage: true });
    expect(screen.getByText('加载中')).toBeInTheDocument();
  });

  it('换筛选的占位期间不预取（旧游标配新条件会拉错页），数据落地后恢复预取', async () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    const { props, rerender } = renderGrid({
      items,
      hasNextPage: true,
      isPlaceholderData: true,
    });

    // 列表保持可见（不换骨架），只给轻量提示
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(props.fetchNextPage).not.toHaveBeenCalled();

    // 仅翻转占位标记（数据不变）：此时才允许预取
    rerender(
      <AntdApp>
        <KnowledgeGrid {...props} isPlaceholderData={false} />
      </AntdApp>,
    );
    await waitFor(() => expect(props.fetchNextPage).toHaveBeenCalled());
  });

  it('把 pendingIds 落到对应卡片的禁用态', () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    renderGrid({
      items,
      hasNextPage: false,
      pendingIds: { like: 'kb1', update: null, delete: 'kb1' },
    });

    expect(screen.getByRole('button', { name: '点赞' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeDisabled();
    // 未 pending 的操作不受影响
    expect(screen.getByRole('button', { name: '设为公开' })).toBeEnabled();
  });

  it('pendingIds 指向别的知识库时当前卡片保持可用', () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    renderGrid({
      items,
      hasNextPage: false,
      pendingIds: { like: 'kb9', update: 'kb9', delete: 'kb9' },
    });

    expect(screen.getByRole('button', { name: '点赞' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeEnabled();
  });

  it('把 onEdit 透传到卡片：点击编辑按钮时收到该卡片', async () => {
    const items: KnowledgeBase[] = [
      makeKb('kb1', '知识库 A'),
      makeKb('kb2', '知识库 B'),
    ];
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 1, start: 0, size: 200, lane: 0, key: 1 },
    ]);
    const onEdit = vi.fn();
    renderGrid({ items, hasNextPage: false, onEdit });

    // 只渲染了索引 1 的卡片，点击它应透传 kb2
    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(onEdit).toHaveBeenCalledWith(items[1]);
  });

  it('把点赞/可见性/删除意图透传到路由持有的回调', async () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    const onToggleLike = vi.fn();
    const onToggleVisibility = vi.fn();
    const onDelete = vi.fn();
    renderGrid({
      items,
      hasNextPage: false,
      onToggleLike,
      onToggleVisibility,
      onDelete,
    });

    await userEvent.click(screen.getByRole('button', { name: '点赞' }));
    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));
    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

    expect(onToggleLike).toHaveBeenCalledWith(items[0]);
    expect(onToggleVisibility).toHaveBeenCalledWith(items[0]);
    expect(onDelete).toHaveBeenCalledWith(items[0]);
  });

  it('未传 onEdit 时点击编辑按钮不抛错', async () => {
    const items: KnowledgeBase[] = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    renderGrid({ items, hasNextPage: false });

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));
  });

  it('把 initialRestoreIndex 透传给虚拟化并恢复到保存位置', () => {
    const items = [makeKb('kb1', '知识库 A'), makeKb('kb2', '知识库 B')];
    renderGrid({
      scrollElement: document.createElement('div'),
      items,
      hasNextPage: false,
      initialRestoreIndex: 1,
    });
    // 恢复改用 getOffsetForIndex（返回目标 offset，可同步对齐实例内部 offset），
    // 不再走只写 DOM 的 scrollToIndex
    expect(virtualizerStub.getOffsetForIndex).toHaveBeenCalledWith(1, 'start');
    expect(virtualizerStub.scrollOffset).toBe(123);
    expect(virtualizerStub.scrollToIndex).not.toHaveBeenCalled();
  });

  it('恢复完成前不渲染卡片（不白挂顶部那一窗）；容器就绪后解锁渲染', () => {
    const items = [makeKb('kb1', '知识库 A')];
    makeFirstItemVisible();
    virtualizerStub.getTotalSize.mockReturnValue(200);
    const props = {
      items,
      isLoading: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      isPlaceholderData: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      hasFilter: false,
      ...cardHandlers(),
      // 恢复目标超出当前条数：不滚动，但仍要走完「解锁渲染」
      initialRestoreIndex: 5,
    };

    const { container, rerender } = render(
      <AntdApp>
        <KnowledgeGrid {...props} scrollElement={null} />
      </AntdApp>,
    );

    // scrollElement 还没就绪 → 虚拟化的可视区间仍按顶部算，此时渲染卡片等于白挂一整窗
    expect(container.querySelector('[data-index]')).toBeNull();
    expect(screen.queryByText('知识库 A')).not.toBeInTheDocument();
    // 容器高度（totalSize）与 footer 保持原样：几何不受影响
    const wrapper = container.querySelector(
      'div[style*="position: relative"]',
    ) as HTMLElement | null;
    expect(wrapper?.style.height).toBe('200px');
    expect(screen.getByText('已加载全部')).toBeInTheDocument();

    rerender(
      <AntdApp>
        <KnowledgeGrid
          {...props}
          scrollElement={document.createElement('div')}
        />
      </AntdApp>,
    );
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
  });

  it('把首可见项变化回调透传给虚拟化', () => {
    const items = [makeKb('kb1', '知识库 A')];
    const onFirstVisibleItemChange = vi.fn();
    renderGrid({
      scrollElement: document.createElement('div'),
      items,
      hasNextPage: false,
      onFirstVisibleItemChange,
    });
    const options = useVirtualizerMock.mock.calls[0][0] as {
      onChange: (instance: { getVirtualItems: () => unknown[] }) => void;
    };
    options.onChange({
      getVirtualItems: () => [
        { index: 0, start: 0, size: 200, lane: 0, key: 0 },
      ],
    });
    expect(onFirstVisibleItemChange).toHaveBeenCalledWith(0);
  });
});
