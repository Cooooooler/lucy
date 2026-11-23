import {
  CARD_ESTIMATED_HEIGHT,
  computeGridLayout,
  GRID_GAP,
  GRID_TOP_GAP,
} from '@/components/grid-layout';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

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
  /**
   * 上一次「取下一页」失败时为 true。失败后**必须停手**：`isFetchingNextPage` 由 true 变 false
   * 会让触底 effect 重新满足条件并立刻再发一次请求（失败 → 重发 → 失败，无限重试），
   * 而失败重试的入口交给页脚按钮，由此处只负责不再自动触发。
   */
  isFetchNextPageError?: boolean;
};

/** 随宽度「分档」变化的几何量：列数与列间距。卡片宽度由 CSS 计算（见 VirtualCardGrid） */
export type GridBreakpoints = {
  columns: number;
  gap: number;
};

/** 取宽度对应的分档几何（列宽等连续量此处用不到，由 CSS 表达） */
function toBreakpoints(width: number): GridBreakpoints {
  const { columns, gap } = computeGridLayout(width);
  return { columns, gap };
}

/** 容器宽度未知时（首个 commit 之前）按 0 宽度分档，与旧行为一致 */
const INITIAL_BREAKPOINTS = toBreakpoints(0);

/**
 * 容器的**内容盒**宽度：即卡片 `100%` 实际解析到的宽度（包含块是内容盒）。
 *
 * 滚动容器是 PageShell 时它自带居中内边距（`.lucy-page-gutter`，见 index.css），`clientWidth`
 * 量到的是内边距盒，比内容盒宽出一个 paddingLeft + paddingRight——直接拿来分档会在
 * 临界宽度上多算一列（实测 1280px 容器 + 两侧各 32px 时按内边距盒得 4 列、按内容盒
 * 只有 3 列）。扣掉内边距后与 ResizeObserver 的 `contentRect`（本就是内容盒）口径一致。
 */
function contentWidthOf(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  return Math.max(0, element.clientWidth - padding);
}

// 固定行高是纯常量函数（忽略入参），提到模块级：useVirtualizer 每次渲染都用新 options
// 调 setOptions，内联闭包会造成无谓的引用抖动。getScrollElement 闭包了 scrollElement，
// 不能提升，保持内联。
const estimateSize = () => CARD_ESTIMATED_HEIGHT + GRID_GAP;

/**
 * 订阅容器宽度并给出「分档」几何（列数/内边距）。抽出来是为了让**加载骨架**与虚拟网格
 * 共用同一分档口径：骨架若按视口断点（md/lg/xl）分列、真实网格按容器宽度分列，
 * 冷加载完成那一刻会整格跳列。
 *
 * 读内容盒宽度的时机是这里的关键：React 在渲染期与**每次提交后**都会重读快照，
 * 而提交那一刻正是 React 刚把卡片内联样式写进 DOM 的时候——每次都读布局属性会强制同步重排
 * （滚动时每帧一次）。因此只在「容器换了」与 ResizeObserver 回调里读，快照本身只读 ref。
 * 首个 commit 那次读取必须保留：容器就绪的那一帧就得拿到真实列数，否则恢复滚动位置会按
 * 错误列数算 offset（改用 useState + 被动 effect 则会先画一帧零宽单列）。
 */
export function useGridBreakpoints(
  scrollElement: HTMLElement | null,
): GridBreakpoints {
  const widthRef = useRef(0);
  /** 已经量过宽度的容器：不等于 scrollElement 时说明是新容器，需要重新量一次 */
  const measuredElementRef = useRef<HTMLElement | null>(null);
  const breakpointsRef = useRef<GridBreakpoints>(INITIAL_BREAKPOINTS);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!scrollElement) return () => {};
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (typeof width === 'number') widthRef.current = width;
        onChange();
      });
      observer.observe(scrollElement);
      return () => observer.disconnect();
    },
    [scrollElement],
  );

  // 快照取「分档量」而非连续宽度：命中同一列数/内边距时返回**同一对象**，
  // useSyncExternalStore 据此判定「没变」而跳过整格重渲染；连续变化的列宽交给 CSS 承担。
  const getSnapshot = useCallback(() => {
    if (measuredElementRef.current !== scrollElement) {
      measuredElementRef.current = scrollElement;
      widthRef.current = scrollElement ? contentWidthOf(scrollElement) : 0;
    }
    const next = toBreakpoints(widthRef.current);
    const cached = breakpointsRef.current;
    if (cached.columns === next.columns) {
      return cached;
    }
    breakpointsRef.current = next;
    return next;
  }, [scrollElement]);

  // 服务端渲染兜底（本仓是 SPA，用不到，但保持 useSyncExternalStore 三参契约完整）
  const getServerSnapshot = useCallback(() => INITIAL_BREAKPOINTS, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

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
  isFetchNextPageError = false,
}: UseVirtualGridOptions) {
  const layout = useGridBreakpoints(scrollElement);

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
    // 网格顶部留白：虚拟列表用绝对定位，容器的 padding-top 对绝对定位子元素不生效，
    // 只能靠虚拟化自己的 paddingStart 把所有 item 的 start 整体下移。
    // 不能用 scrollMargin：它被加到 start 上却在 getTotalSize 里被减掉，
    // 容器会少 16px，末行卡片自带的下间距被吃掉；且写法隐含依赖
    // GRID_TOP_GAP ≤ GRID_GAP，一旦调大就压到页脚上。
    paddingStart: GRID_TOP_GAP,
    // overscan 的单位是「条目」而非行：从 3 降到 1 只少挂 4 张卡片（实测），并非少挂 3 行。
    // 取 1（库默认值）保留一行左右的缓冲，兼顾滚动流畅与首屏渲染量。
    overscan: 1,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.reduce(
    (max, item) => Math.max(max, item.index),
    -1,
  );

  useEffect(() => {
    // 占位数据属于上一组筛选条件，它的 nextCursor 与新条件不匹配：
    // 此时翻页 = 旧游标 + 新过滤条件，会拉到一页与当前列表无关的数据
    if (isPlaceholderData) return;
    // 上一次取下一页已失败：停手，等用户在页脚主动重试。
    // 不停手的话 isFetchingNextPage 由 true→false 会让本 effect 立刻重发，形成失败重试风暴。
    if (isFetchNextPageError) return;
    if (!hasNextPage || isFetchingNextPage) return;
    // 提前两行预取
    if (lastVisibleIndex >= count - layout.columns * 2) fetchNextPage();
  }, [
    isPlaceholderData,
    isFetchNextPageError,
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
  };
}
