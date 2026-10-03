import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelProviderGrid } from './ModelProviderGrid';
import { baseModel } from './model-provider-test-fixture';

const useVirtualizerMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: useVirtualizerMock,
}));

const virtualizerStub = {
  getVirtualItems: vi.fn(),
  getTotalSize: vi.fn(() => 0),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  getOffsetForIndex: vi.fn(() => [123, 'start'] as const),
  scrollOffset: null as number | null,
};

type GridProps = ComponentProps<typeof ModelProviderGrid>;

function cardHandlers() {
  return {
    onDelete: vi.fn(),
    onTest: vi.fn(),
    pendingIds: { update: null, delete: null, test: null },
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
        <ModelProviderGrid {...props} />
      </AntdApp>,
    ),
    props,
  };
}

function makeFirstItemVisible() {
  virtualizerStub.getVirtualItems.mockReturnValue([
    { index: 0, start: 0, size: 200, lane: 0, key: 0 },
  ]);
}

describe('ModelProviderGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVirtualizerMock.mockReturnValue(virtualizerStub);
    virtualizerStub.getVirtualItems.mockReturnValue([]);
    virtualizerStub.getTotalSize.mockReturnValue(0);
  });

  it('加载中渲染 6 个骨架卡片', () => {
    const { container } = renderGrid({ isLoading: true });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
  });

  it('失败渲染错误态与重试', async () => {
    const { props } = renderGrid({ isError: true, error: new Error('boom') });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByText('重试'));
    expect(props.refetch).toHaveBeenCalled();
  });

  it('空态按是否有筛选区分文案', () => {
    const { unmount } = renderGrid({ items: [], hasFilter: false });
    expect(screen.getByText('暂无模型')).toBeInTheDocument();
    unmount();

    renderGrid({ items: [], hasFilter: true });
    expect(screen.getByText('没有匹配的模型')).toBeInTheDocument();
  });

  it('有数据时渲染虚拟卡片并透传事件', async () => {
    makeFirstItemVisible();
    const { props } = renderGrid({ items: [baseModel], hasNextPage: false });
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('测试连接'));
    expect(props.onTest).toHaveBeenCalledWith(baseModel);
  });

  it('取下一页失败时页脚就地提示并可重试', async () => {
    makeFirstItemVisible();
    const { props } = renderGrid({
      items: [baseModel],
      hasNextPage: true,
      isFetchNextPageError: true,
    });
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByText('重试'));
    expect(props.fetchNextPage).toHaveBeenCalled();
  });
});
