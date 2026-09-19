import {
  CARD_ESTIMATED_HEIGHT,
  computeGridLayout,
  GRID_GAP,
} from '@/components/knowledge/grid-layout';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

type UseVirtualGridOptions = {
  /** 滚动容器（也是虚拟化的 scrollElement） */
  scrollElement: HTMLElement | null;
  /** 已加载的条目数 */
  count: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /**
   * 当前渲染的是上一组筛选条件的占位数据（`keepPreviousData`）时为 true。
   * 占位页携带的是**旧条件**的 nextCursor，此时翻页会把旧游标配新条件发出去，必须停手。
   */
  isPlaceholderData?: boolean;
  /** 挂载时一次性恢复到的首可见项索引；仅当 0 < index < count 时生效 */
  initialRestoreIndex?: number;
  /** 首可见项索引变化回调（滚动中持续上报，不触发渲染） */
  onFirstVisibleItemChange?: (index: number) => void;
  /**
   * 本次挂载的恢复动作已结束（无论是否需要滚动）时回调一次。
   * 调用方据此清掉恢复锚点：网格会随筛选切换卸载重挂（加载态 → 有数据），
   * 锚点若留在调用方，重挂时会再次回放恢复，把改筛选后的「回到顶部」覆盖掉。
   */
  onRestoreDone?: () => void;
};

/** 随宽度「分档」变化的几何量：列数与左右内边距。卡片宽度由 CSS 计算（见 KnowledgeGridVirtual） */
export type GridBreakpoints = {
  columns: number;
  padding: number;
  gap: number;
};

/** 取宽度对应的分档几何（列宽等连续量此处用不到，由 CSS 表达） */
function toBreakpoints(width: number): GridBreakpoints {
  const { columns, padding, gap } = computeGridLayout(width);
  return { columns, padding, gap };
}

// 固定行高是纯常量函数（忽略入参），提到模块级：useVirtualizer 每次渲染都用新 options
// 调 setOptions，内联闭包会造成无谓的引用抖动。getScrollElement 闭包了 scrollElement，
// 不能提升，保持内联。
const estimateSize = () => CARD_ESTIMATED_HEIGHT + GRID_GAP;

/**
 * 虚拟化网格：按容器宽度动态决定列数（lanes），并用虚拟窗口触发触底加载。
 * 触底加载交给虚拟化的可视区间而非 IntersectionObserver——虚拟列表里 DOM 不存在
 * 真实哨兵，只有可视项才有意义。
 */
export function useVirtualGrid({
  scrollElement,
  count,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  isPlaceholderData = false,
  initialRestoreIndex = 0,
  onFirstVisibleItemChange,
  onRestoreDone,
}: UseVirtualGridOptions) {
  // 恢复完成的回调只在下面的 layout effect 里用一次：Effect Event 让它在 effect 内
  // 始终是最新实现，同时身份稳定、不必进 effect 依赖数组——这正是「ref + 被动 effect
  // 手工补写最新回调」那套写法要解决的问题（且那套写法在同一 commit 内仍有陈旧窗口）。
  const notifyRestoreDone = useEffectEvent(() => {
    onRestoreDone?.();
  });

  // 容器宽度是「外部可变值」：用 useSyncExternalStore 在渲染期读 DOM。
  // 不能用 useState + effect：那样的首次渲染宽度未知，会先绘制一帧 width=0 的
  // 零宽单列布局（列表缓存保留后首帧就有数据，这一帧真的会被看见）。
  const subscribeResize = useCallback(
    (onChange: () => void) => {
      if (!scrollElement) return () => {};
      const observer = new ResizeObserver(() => onChange());
      observer.observe(scrollElement);
      return () => observer.disconnect();
    },
    [scrollElement],
  );

  // 快照刻意取「分档量」而不是连续的 clientWidth：ResizeObserver 每像素都回调一次，
  // 快照若是宽度，拖拽窗口的每一像素都会让整格重渲染（重算几何 + 虚拟化 options 抖动）。
  // 命中同一列数/内边距时返回**同一对象**，useSyncExternalStore 据此判定「没变」而跳过渲染；
  // 连续变化的列宽改由 CSS 承担，浏览器自己重排。
  const breakpointsRef = useRef<GridBreakpoints | null>(null);
  const getBreakpoints = useCallback(() => {
    const next = toBreakpoints(scrollElement?.clientWidth ?? 0);
    const cached = breakpointsRef.current;
    if (cached?.columns === next.columns && cached.padding === next.padding) {
      return cached;
    }
    breakpointsRef.current = next;
    return next;
  }, [scrollElement]);
  const layout = useSyncExternalStore(subscribeResize, getBreakpoints);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    // 关闭库内部的 flushSync：本 hook 会在 layout effect 里同步对齐滚动位置（恢复），
    // 而库默认在「同步通知」路径上 flushSync 重渲染，等于在 React 提交阶段嵌套一次同步渲染
    // ——控制台报 "flushSync was called from inside a lifecycle method"，
    // 且每次都要同步重渲染整窗卡片（实测单次数百毫秒）导致返回时明显卡顿。
    // 恢复与滚动更新交给 React 自身调度即可，不需要强制同步刷新。
    useFlushSync: false,
    // 固定行高：卡片等高（标题单行省略 + 描述 h-11），故无需 measureElement 回填真实高度。
    // 交给虚拟化器测量会引入「测量 → 通知 → 再整窗渲染一次」的第二趟渲染（实测该帧阻塞 600ms+），
    // 卡片等高后这趟渲染纯属浪费；行高与真实高度的一致性由 CARD_ESTIMATED_HEIGHT 的注释约束。
    estimateSize,
    lanes: layout.columns,
    // overscan 的单位是「条目」而非行：从 3 降到 1 只少挂 4 张卡片（实测），并非少挂 3 行。
    // 取 1（库默认值）保留一行左右的缓冲，兼顾滚动流畅与首屏渲染量。
    overscan: 1,
    // 首可见项索引是「返回恢复」的锚点：索引与 DOM 高度解耦，落点不受重新测量影响。
    // 不能用 getVirtualItems()[0]——默认 rangeExtractor 会把 overscan 项也算进来，
    // 上报值会比真实首可见项小 overscan，往返会累积向上漂移。
    // 取「起点不晚于视口顶部的最后一项」：视口顶部落在某行内部时，该行仍部分可见，
    // 才是真正的首可见项；取首个 start >= offset 会跳过它，恢复时整卡下移一行。
    //
    // 这里直接用 props 里的回调（不做 ref/Effect Event 包装）：库每次渲染都会
    // setOptions，本就持有最新实现；而 Effect Event 只在 effect 内可调用，
    // 本回调却会被滚动/尺寸监听与命令式滚动触发（都在 effect 之外）。
    onChange: (instance) => {
      const offset = instance.scrollOffset ?? 0;
      const items = instance.getVirtualItems();
      let first: { index: number; start: number } | undefined;
      for (const item of items) {
        if (item.start > offset) continue;
        if (!first || item.start > first.start) first = item;
      }
      // 兜底：渲染区间尚未覆盖视口顶部时（如测量前的首帧）沿用最早渲染的一项，
      // 否则会漏掉这次上报，锚点停在上一个位置
      const anchor = first ?? items[0];
      if (anchor) onFirstVisibleItemChange?.(anchor.index);
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.reduce(
    (max, item) => Math.max(max, item.index),
    -1,
  );

  // 恢复是否已完成（见下方一次性恢复 layout effect）
  const [restored, setRestored] = useState(false);
  // 有恢复目标且尚未完成恢复时，先不渲染卡片：避免先挂载顶部窗口再跳到恢复位置（白挂一整窗）
  const restorePending = initialRestoreIndex > 0 && !restored;

  // 一次性恢复：容器就绪且有数据时，若保存位置在当前数据范围内则把滚动位置对齐过去，否则保持顶部。
  // scrollElement 由 ref 回调里的 setState 提供，因此恢复落在「容器就绪且 count > 0 的首个 commit」，
  // 而非路由挂载的那个 commit。restoredRef 保证只执行一次（同时吸收 StrictMode 双跑）。
  // 用 useLayoutEffect 在该 commit 内、绘制前完成跳转，避免「先绘制顶部再跳转」的可见跳动。
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    if (!scrollElement || count === 0) return;
    restoredRef.current = true;
    if (initialRestoreIndex > 0 && initialRestoreIndex < count) {
      const info = virtualizer.getOffsetForIndex(initialRestoreIndex, 'start');
      if (info) {
        const [offset] = info;
        // 必须先把 DOM 与实例内部 offset 一起对齐：
        // 库只在 scroll 事件里更新内部 scrollOffset（异步），若只写 DOM，
        // 本次提交仍会按旧位置算范围 → 先白挂一整窗卡片
        scrollElement.scrollTop = offset;
        virtualizer.scrollOffset = offset;
      }
    }
    // 解锁卡片渲染。该 setState 发生在 layout effect 中，React 会在绘制前完成重渲染，
    // 因此那一帧空网格不会被用户看到。
    // react-x/set-state-in-effect 会在这一行告警，但本处是刻意的：挪到被动 effect 会先绘制一帧空网格，
    // 而「effect 里多渲染一趟」正是用来换掉「先挂顶部窗口再跳到恢复位置」的那一整窗白挂（见 restorePending）。
    // eslint-disable-next-line react-x/set-state-in-effect
    setRestored(true);
    // 通知调用方消费掉恢复锚点（见 onRestoreDone 的说明）
    notifyRestoreDone();
  }, [scrollElement, count, initialRestoreIndex, virtualizer]);

  useEffect(() => {
    // 占位数据属于上一组筛选条件，它的 nextCursor 与新条件不匹配：
    // 此时翻页 = 旧游标 + 新过滤条件，会拉到一页与当前列表无关的数据
    if (isPlaceholderData) return;
    if (!hasNextPage || isFetchingNextPage) return;
    // 提前两行预取
    if (lastVisibleIndex >= count - layout.columns * 2) fetchNextPage();
  }, [
    isPlaceholderData,
    lastVisibleIndex,
    count,
    hasNextPage,
    isFetchingNextPage,
    layout.columns,
    fetchNextPage,
  ]);

  return {
    layout,
    virtualItems,
    totalSize: virtualizer.getTotalSize(),
    restorePending,
  };
}
