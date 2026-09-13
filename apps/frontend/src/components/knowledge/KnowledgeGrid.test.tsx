import type { KnowledgeBase } from '@/api/types';
import {
  useDeleteKnowledgeBase,
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
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

vi.mock('@/hooks/use-knowledge', () => ({
  useUpdateKnowledgeBase: vi.fn(),
  useLikeKnowledgeBase: vi.fn(),
  useUnlikeKnowledgeBase: vi.fn(),
  useDeleteKnowledgeBase: vi.fn(),
}));

const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);
const mockedLike = vi.mocked(useLikeKnowledgeBase);
const mockedUnlike = vi.mocked(useUnlikeKnowledgeBase);
const mockedDelete = vi.mocked(useDeleteKnowledgeBase);

const virtualizerStub = {
  getVirtualItems: vi.fn(),
  getTotalSize: vi.fn(() => 0),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  /** 恢复路径：返回 [目标 offset, align] */
  getOffsetForIndex: vi.fn(() => [123, 'start'] as const),
  scrollOffset: null as number | null,
};

function noopMutationMock() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  };
}

function mockCardHooks() {
  mockedUpdate.mockReturnValue(
    noopMutationMock() as unknown as ReturnType<typeof useUpdateKnowledgeBase>,
  );
  mockedLike.mockReturnValue(
    noopMutationMock() as unknown as ReturnType<typeof useLikeKnowledgeBase>,
  );
  mockedUnlike.mockReturnValue(
    noopMutationMock() as unknown as ReturnType<typeof useUnlikeKnowledgeBase>,
  );
  mockedDelete.mockReturnValue(
    noopMutationMock() as unknown as ReturnType<typeof useDeleteKnowledgeBase>,
  );
}

type GridProps = ComponentProps<typeof KnowledgeGrid>;

function renderGrid(overrides: Partial<GridProps> = {}) {
  const props: GridProps = {
    scrollElement: null,
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    hasFilter: false,
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

describe('KnowledgeGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCardHooks();
    virtualizerStub.getVirtualItems.mockReturnValue([]);
    virtualizerStub.getTotalSize.mockReturnValue(0);
    virtualizerStub.scrollToIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReturnValue([123, 'start']);
    virtualizerStub.scrollOffset = null;
    useVirtualizerMock.mockReturnValue(virtualizerStub);
  });

  it('加载中渲染 6 个骨架卡片', () => {
    const { container } = renderGrid({ isLoading: true });
    expect(container.querySelectorAll('.ant-skeleton')).toHaveLength(6);
  });

  it('失败时渲染错误态并可重试', async () => {
    const { props } = renderGrid({
      isError: true,
      error: new Error('网络异常'),
    });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('网络异常')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(props.refetch).toHaveBeenCalledTimes(1);
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

  it('接近末尾时触发预取，且不显示已加载全部', async () => {
    const items = [makeKb('kb1', '知识库 A')];
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 200, lane: 0, key: 0 },
    ]);
    const { props } = renderGrid({ items, hasNextPage: true });
    await waitFor(() => expect(props.fetchNextPage).toHaveBeenCalled());
    expect(screen.queryByText('已加载全部')).not.toBeInTheDocument();
  });

  it('加载下一页时显示加载中', () => {
    const items = [makeKb('kb1', '知识库 A')];
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 200, lane: 0, key: 0 },
    ]);
    renderGrid({ items, hasNextPage: true, isFetchingNextPage: true });
    expect(screen.getByText('加载中')).toBeInTheDocument();
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

  it('未传 onEdit 时点击编辑按钮不抛错', async () => {
    const items: KnowledgeBase[] = [makeKb('kb1', '知识库 A')];
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 200, lane: 0, key: 0 },
    ]);
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
    virtualizerStub.getVirtualItems.mockReturnValue([
      { index: 0, start: 0, size: 200, lane: 0, key: 0 },
    ]);
    virtualizerStub.getTotalSize.mockReturnValue(200);
    const props = {
      items,
      isLoading: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
      hasFilter: false,
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
