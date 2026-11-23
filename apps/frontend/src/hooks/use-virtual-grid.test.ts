import {
  CARD_ESTIMATED_HEIGHT,
  GRID_GAP,
  GRID_TOP_GAP,
} from '@/components/grid-layout';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVirtualGrid } from './use-virtual-grid';

const useVirtualizerMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: useVirtualizerMock,
}));

type VirtualItemStub = {
  index: number;
  start: number;
  size: number;
  lane: number;
  key: number;
};

const virtualizerStub = {
  getVirtualItems: vi.fn<() => VirtualItemStub[]>(),
  getTotalSize: vi.fn(() => 0),
};

function makeVirtualItem(index: number): VirtualItemStub {
  return { index, start: index * 200, size: 200, lane: 0, key: index };
}

/** 容器宽度可控的滚动元素（jsdom 无布局盒，clientWidth 恒为 0） */
function makeSizedScrollElement(initialWidth: number): {
  element: HTMLDivElement;
  setWidth: (width: number) => void;
} {
  const element = document.createElement('div');
  let clientWidth = initialWidth;
  Object.defineProperty(element, 'clientWidth', {
    get: () => clientWidth,
    configurable: true,
  });
  return { element, setWidth: (width) => (clientWidth = width) };
}

/**
 * setup.ts 的 ResizeObserver 是 no-op 桩（回调永不触发），这里换成会记住回调的桩，
 * 用来驱动 useSyncExternalStore 的 subscribe → onChange → 渲染期重读快照这条分支——
 * 这是宽度改由 useSyncExternalStore 提供后唯一在 jsdom 下拿不到覆盖的路径。
 * `resize(width)` 模拟真实通知：回调必须收到 entries（宽度从 contentRect 里取）。
 */
function stubCapturingResizeObserver(): {
  resize: (width: number) => void;
  disconnected: () => number;
} {
  const callbacks: ((entries: ResizeObserverEntry[]) => void)[] = [];
  let disconnected = 0;
  class CapturingResizeObserver {
    constructor(callback: (entries: ResizeObserverEntry[]) => void) {
      callbacks.push(callback);
    }

    observe(): void {
      void 0;
    }

    unobserve(): void {
      void 0;
    }

    disconnect(): void {
      disconnected += 1;
    }
  }
  vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
  return {
    resize: (width) => {
      for (const callback of callbacks) {
        callback([{ contentRect: { width } } as ResizeObserverEntry]);
      }
    },
    disconnected: () => disconnected,
  };
}

describe('useVirtualGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVirtualizerMock.mockReturnValue(virtualizerStub);
    virtualizerStub.getVirtualItems.mockReturnValue([]);
    virtualizerStub.getTotalSize.mockReturnValue(0);
  });

  it('把 count 与按宽度算出的 lanes 传给虚拟化器', () => {
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 7,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );
    expect(useVirtualizerMock).toHaveBeenCalledWith(
      expect.objectContaining({ count: 7, lanes: 1 }),
    );
  });

  it('关闭库内部的 flushSync：同步通知路径不强制同步重渲染', () => {
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 1,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );
    expect(useVirtualizerMock).toHaveBeenCalledWith(
      expect.objectContaining({ useFlushSync: false }),
    );
  });

  it('可视区间接近末尾时触发预取', () => {
    virtualizerStub.getVirtualItems.mockReturnValue([
      makeVirtualItem(0),
      makeVirtualItem(4),
    ]);
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('已在请求中时不重复预取', () => {
    virtualizerStub.getVirtualItems.mockReturnValue([makeVirtualItem(5)]);
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage,
      }),
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('没有下一页时不预取', () => {
    virtualizerStub.getVirtualItems.mockReturnValue([makeVirtualItem(5)]);
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage,
      }),
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('固定行高：estimateSize 返回卡片高度 + 行间距，且不传 measureElement（避免测量后的第二趟渲染）', () => {
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 1,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      estimateSize: () => number;
    };
    expect(options.estimateSize()).toBe(CARD_ESTIMATED_HEIGHT + GRID_GAP);
    expect(options).not.toHaveProperty('measureElement');
  });

  it('用 paddingStart 给网格留出顶部空白（绝对定位不吃容器的 padding-top）', () => {
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 1,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      paddingStart: number;
    };
    // paddingStart 计入 getTotalSize，容器高度等于真实内容高度
    expect(options.paddingStart).toBe(GRID_TOP_GAP);
  });

  it('不用 scrollMargin 留白：它被 getTotalSize 减掉，末行卡片会被页脚压住', () => {
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 1,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      scrollMargin?: number;
    };
    expect(options.scrollMargin).toBeUndefined();
  });

  it('ResizeObserver 触发后按新宽度重算 lanes', () => {
    const { element: scrollElement } = makeSizedScrollElement(1600);
    // computeGridLayout(1600).columns === 4
    const { resize, disconnected } = stubCapturingResizeObserver();

    try {
      const { unmount } = renderHook(() =>
        useVirtualGrid({
          scrollElement,
          count: 20,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      );
      const lastLanes = () =>
        (useVirtualizerMock.mock.calls.at(-1)?.[0] as { lanes: number }).lanes;
      expect(lastLanes()).toBe(4);

      act(() => resize(700)); // computeGridLayout(700).columns === 2

      expect(lastLanes()).toBe(2);

      // 清理职责在 subscribe 的返回值上（原来的 observer.disconnect() 已删除）
      unmount();
      expect(disconnected()).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('按内容盒宽度分档：扣掉滚动容器的左右内边距，临界宽度上不会多算一列', () => {
    const { element: scrollElement } = makeSizedScrollElement(1280);
    // 滚动容器是 PageShell 时自带 px（md 档两侧各 32px）：内边距盒 1280 → 4 列，内容盒 1216 → 3 列
    scrollElement.style.paddingLeft = '32px';
    scrollElement.style.paddingRight = '32px';

    renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
      }),
    );

    const lanes = (
      useVirtualizerMock.mock.calls.at(-1)?.[0] as { lanes: number }
    ).lanes;
    expect(lanes).toBe(3);
  });

  it('同一分档内的宽度变化不重渲染（快照返回同一引用）', () => {
    const { element: scrollElement } = makeSizedScrollElement(1200);
    // 1200 与 1100 都是 3 列档（computeGridLayout(1200).columns === 3）
    const { resize } = stubCapturingResizeObserver();

    try {
      const { result } = renderHook(() =>
        useVirtualGrid({
          scrollElement,
          count: 20,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
        }),
      );
      const firstLayout = result.current.layout;
      expect(firstLayout.columns).toBe(3);

      act(() => resize(1100));

      // useSyncExternalStore 以引用相等判断「快照没变」：同一档位返回同一对象，
      // 拖拽窗口的逐像素通知因此不会让整格重渲染（列宽已交给 CSS）
      expect(result.current.layout).toBe(firstLayout);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('占位数据期间不预取（旧游标配新条件会拉错页）', () => {
    virtualizerStub.getVirtualItems.mockReturnValue([makeVirtualItem(5)]);
    const fetchNextPage = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
        isPlaceholderData: true,
      }),
    );
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('取下一页失败后停手：不再自动重发（否则 true→false 会触发失败重试风暴）', () => {
    virtualizerStub.getVirtualItems.mockReturnValue([makeVirtualItem(5)]);
    const fetchNextPage = vi.fn();
    const { rerender } = renderHook(
      ({ isFetchNextPageError }: { isFetchNextPageError: boolean }) =>
        useVirtualGrid({
          scrollElement: null,
          count: 6,
          hasNextPage: true,
          isFetchingNextPage: false,
          fetchNextPage,
          isFetchNextPageError,
        }),
      { initialProps: { isFetchNextPageError: false } },
    );
    // 正常情况会预取一次
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // 失败后（isFetchingNextPage 也由 true 回到 false）不能再自动发请求
    rerender({ isFetchNextPageError: true });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    // 用户重试成功后恢复自动预取
    rerender({ isFetchNextPageError: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });
});
