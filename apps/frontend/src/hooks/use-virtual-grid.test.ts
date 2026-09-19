import {
  CARD_ESTIMATED_HEIGHT,
  GRID_GAP,
} from '@/components/knowledge/grid-layout';
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
  scrollToIndex: vi.fn(),
  /** 恢复路径：返回 [目标 offset, align]；库没测量到该项时返回 undefined */
  getOffsetForIndex: vi.fn<() => readonly [number, string] | undefined>(),
  /** 实例内部 offset：恢复时由本 hook 直接对齐（库自身只在 scroll 事件里更新它） */
  scrollOffset: null as number | null,
};

function makeVirtualItem(index: number): VirtualItemStub {
  return { index, start: index * 200, size: 200, lane: 0, key: index };
}

/**
 * jsdom 没有布局盒，`Element.prototype.scrollTop` 的 getter 恒返回 0、setter 是空操作，
 * 因此把它改写成可读写的普通数据属性，才能断言恢复真的写入了滚动位置。
 */
function makeScrollElement(): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', {
    value: 0,
    writable: true,
    configurable: true,
  });
  return el;
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
    virtualizerStub.scrollToIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReset();
    virtualizerStub.getOffsetForIndex.mockReturnValue([123, 'start']);
    virtualizerStub.scrollOffset = null;
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

  it('关闭库内部的 flushSync：恢复在 layout effect 里调用 scrollToIndex，强制同步刷新会报错且卡顿', () => {
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

  it('通过 onChange 上报首可见项索引', () => {
    const onFirstVisibleItemChange = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        onFirstVisibleItemChange,
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      onChange: (instance: {
        getVirtualItems: () => VirtualItemStub[];
      }) => void;
    };
    options.onChange({ getVirtualItems: () => [makeVirtualItem(4)] });
    expect(onFirstVisibleItemChange).toHaveBeenCalledWith(4);
  });

  it('上报视口顶部所在的行，剔除 overscan 提前渲染的、已滚过的行', () => {
    const onFirstVisibleItemChange = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 8,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        onFirstVisibleItemChange,
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      onChange: (instance: {
        scrollOffset: number | null;
        getVirtualItems: () => VirtualItemStub[];
      }) => void;
    };
    // 虚拟项 start 依次为 200 / 400 / 600（前两项是被 overscan 提前渲染的、已滚过的行）。
    // 视口起点 500 → 顶部落在 start=400 的那一行内部，落点为 index 2；
    // 若沿用 getVirtualItems()[0] 会上报 1。
    options.onChange({
      scrollOffset: 500,
      getVirtualItems: () => [
        makeVirtualItem(1),
        makeVirtualItem(2),
        makeVirtualItem(3),
      ],
    });
    expect(onFirstVisibleItemChange).toHaveBeenCalledTimes(1);
    expect(onFirstVisibleItemChange).toHaveBeenCalledWith(2);
  });

  it('视口顶部落在行内部时上报该行，而不是下一行（恢复不会整卡下移）', () => {
    const onFirstVisibleItemChange = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 8,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        onFirstVisibleItemChange,
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      onChange: (instance: {
        scrollOffset: number | null;
        getVirtualItems: () => VirtualItemStub[];
      }) => void;
    };
    // 行高 220px、scrollTop=100：第 0 行（start=0）仍部分可见，才是首可见项；
    // 「首个 start >= offset」会跳过它返回第 1 行，返回恢复时把该卡滚出视口。
    options.onChange({
      scrollOffset: 100,
      getVirtualItems: () => [makeVirtualItem(0), makeVirtualItem(1)],
    });
    expect(onFirstVisibleItemChange).toHaveBeenCalledWith(0);
  });

  it('没有可见项时不调用上报回调', () => {
    const onFirstVisibleItemChange = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 6,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        onFirstVisibleItemChange,
      }),
    );
    const options = useVirtualizerMock.mock.calls[0][0] as {
      onChange: (instance: {
        scrollOffset: number | null;
        getVirtualItems: () => VirtualItemStub[];
      }) => void;
    };
    options.onChange({ scrollOffset: 0, getVirtualItems: () => [] });
    expect(onFirstVisibleItemChange).not.toHaveBeenCalled();
  });

  it('每次渲染都把手头最新的回调交给虚拟化器（不再有 ref + 被动 effect 的陈旧窗口）', () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const { rerender } = renderHook(
      ({ onChange }: { onChange: (index: number) => void }) =>
        useVirtualGrid({
          scrollElement: null,
          count: 6,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          onFirstVisibleItemChange: onChange,
        }),
      { initialProps: { onChange: onA } },
    );

    rerender({ onChange: onB });

    // 库每次渲染都会 setOptions：它持有的是**最后一次**渲染的 options，
    // 因此这里取最新一次调用即可拿到最新回调。旧实现用 ref 在被动 effect 里补写，
    // 同一 commit 内（被动 effect 冲刷前）触发的 onChange 仍会拿到旧回调。
    const options = useVirtualizerMock.mock.calls.at(-1)?.[0] as {
      onChange: (instance: {
        scrollOffset: number | null;
        getVirtualItems: () => VirtualItemStub[];
      }) => void;
    };
    options.onChange({
      scrollOffset: 0,
      getVirtualItems: () => [makeVirtualItem(2)],
    });

    expect(onB).toHaveBeenCalledWith(2);
    expect(onA).not.toHaveBeenCalled();
  });

  it('挂载时把首可见项恢复到保存的索引：DOM 与实例内部 offset 一起对齐', () => {
    const scrollElement = makeScrollElement();
    renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
      }),
    );
    expect(virtualizerStub.getOffsetForIndex).toHaveBeenCalledWith(7, 'start');
    // 两者必须一起写：库只在 scroll 事件（异步）里更新内部 scrollOffset，
    // 只写 DOM 的话本次提交仍按旧位置（顶部）算范围 → 白挂一整窗卡片
    expect(scrollElement.scrollTop).toBe(123);
    expect(virtualizerStub.scrollOffset).toBe(123);
    // scrollToIndex 只经 scrollToFn 写 DOM、不返回 offset，也不再是恢复路径
    expect(virtualizerStub.scrollToIndex).not.toHaveBeenCalled();
  });

  it('有恢复目标时 restorePending 首帧为 true、恢复完成后为 false', () => {
    const scrollElement = makeScrollElement();
    // 记录每次渲染读到的值：首帧必须为 true（此时不渲染卡片），否则会先挂顶部那一窗
    const renderSnapshots: boolean[] = [];
    const { result } = renderHook(() => {
      const grid = useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
      });
      renderSnapshots.push(grid.restorePending);
      return grid;
    });
    expect(renderSnapshots[0]).toBe(true);
    expect(result.current.restorePending).toBe(false);
  });

  it('没有恢复目标（initialRestoreIndex 为 0）时 restorePending 始终为 false', () => {
    const scrollElement = makeScrollElement();
    const renderSnapshots: boolean[] = [];
    const { result } = renderHook(() => {
      const grid = useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 0,
      });
      renderSnapshots.push(grid.restorePending);
      return grid;
    });
    expect(renderSnapshots.every((pending) => pending === false)).toBe(true);
    expect(result.current.restorePending).toBe(false);
  });

  it('容器未就绪时不置位（等下一次提交）：restorePending 保持 true', () => {
    const { result, rerender } = renderHook(
      ({ scrollElement }: { scrollElement: HTMLElement | null }) =>
        useVirtualGrid({
          scrollElement,
          count: 20,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          initialRestoreIndex: 7,
        }),
      { initialProps: { scrollElement: null as HTMLElement | null } },
    );
    // scrollElement 由路由的 ref 回调 setState 提供：就绪前恢复无从谈起，也不能提前解锁渲染
    expect(result.current.restorePending).toBe(true);
    expect(virtualizerStub.getOffsetForIndex).not.toHaveBeenCalled();

    rerender({ scrollElement: makeScrollElement() });
    expect(result.current.restorePending).toBe(false);
    expect(virtualizerStub.getOffsetForIndex).toHaveBeenCalledWith(7, 'start');
  });

  it('等容器宽度确定后再恢复：恢复时的 lanes 已按实测宽度计算', () => {
    const scrollElement = makeScrollElement();
    // computeGridLayout(1600).columns === 4
    Object.defineProperty(scrollElement, 'clientWidth', {
      value: 1600,
      configurable: true,
    });

    let lanesAtRestore: number | undefined;
    virtualizerStub.getOffsetForIndex.mockImplementation(() => {
      const options = useVirtualizerMock.mock.calls.at(-1)?.[0] as {
        lanes: number;
      };
      lanesAtRestore = options.lanes;
      return [123, 'start'] as const;
    });

    renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
      }),
    );

    expect(virtualizerStub.getOffsetForIndex).toHaveBeenCalledWith(7, 'start');
    expect(lanesAtRestore).toBe(4);
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

  it('恢复结束时回调一次 onRestoreDone（调用方据此消费锚点）', () => {
    const scrollElement = makeScrollElement();
    const onRestoreDone = vi.fn();
    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useVirtualGrid({
          scrollElement,
          count,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          initialRestoreIndex: 7,
          onRestoreDone,
        }),
      { initialProps: { count: 20 } },
    );
    expect(onRestoreDone).toHaveBeenCalledTimes(1);

    rerender({ count: 40 });
    expect(onRestoreDone).toHaveBeenCalledTimes(1);
  });

  it('容器未就绪时不回调 onRestoreDone（等真正恢复的那次提交）', () => {
    const onRestoreDone = vi.fn();
    renderHook(() =>
      useVirtualGrid({
        scrollElement: null,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
        onRestoreDone,
      }),
    );
    expect(onRestoreDone).not.toHaveBeenCalled();
  });

  it('只恢复一次，重渲染不重复滚动', () => {
    const scrollElement = makeScrollElement();
    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useVirtualGrid({
          scrollElement,
          count,
          hasNextPage: false,
          isFetchingNextPage: false,
          fetchNextPage: vi.fn(),
          initialRestoreIndex: 7,
        }),
      { initialProps: { count: 20 } },
    );
    rerender({ count: 40 });
    expect(virtualizerStub.getOffsetForIndex).toHaveBeenCalledTimes(1);
  });

  it('保存位置超出已加载条数时不滚动', () => {
    const scrollElement = makeScrollElement();
    const { result } = renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 42,
      }),
    );
    expect(virtualizerStub.getOffsetForIndex).not.toHaveBeenCalled();
    expect(scrollElement.scrollTop).toBe(0);
    // 不滚动也要解锁渲染，否则整张网格永远是空的
    expect(result.current.restorePending).toBe(false);
  });

  it('保存位置等于已加载条数时不滚动', () => {
    const scrollElement = makeScrollElement();
    const { result } = renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 20,
      }),
    );
    expect(virtualizerStub.getOffsetForIndex).not.toHaveBeenCalled();
    expect(result.current.restorePending).toBe(false);
  });

  it('保存位置为 0 时不滚动', () => {
    const scrollElement = makeScrollElement();
    const { result } = renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 0,
      }),
    );
    expect(virtualizerStub.getOffsetForIndex).not.toHaveBeenCalled();
    expect(scrollElement.scrollTop).toBe(0);
    expect(result.current.restorePending).toBe(false);
  });

  it('库返回 undefined（测量未就绪）时不写 offset，但仍解锁渲染', () => {
    const scrollElement = makeScrollElement();
    virtualizerStub.getOffsetForIndex.mockReturnValue(undefined);
    const { result } = renderHook(() =>
      useVirtualGrid({
        scrollElement,
        count: 20,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
      }),
    );
    expect(scrollElement.scrollTop).toBe(0);
    expect(virtualizerStub.scrollOffset).toBeNull();
    expect(result.current.restorePending).toBe(false);
  });
});
