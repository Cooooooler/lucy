import { errorMessageOf } from '@/api/client';
import {
  CARD_ESTIMATED_HEIGHT,
  columnWidthOperand,
  GRID_TOP_GAP,
} from '@/components/grid-layout';
import { useGridBreakpoints, useVirtualGrid } from '@/hooks/use-virtual-grid';
import { Button, Empty, Result, Spin } from 'antd';
import type { FC, ReactNode } from 'react';

/** 空态文案：筛选无结果与尚无数据是两件事，措辞不同 */
export type CardGridEmptyLabel = {
  /** 有筛选条件但没命中 */
  filtered: string;
  /** 一条数据都还没有 */
  initial: string;
};

/**
 * 卡片列表网格：把「查询状态 → 骨架 / 错误 / 空 / 虚拟列表」这段分发逻辑收敛成一处。
 *
 * 卡片本身由调用方通过 `renderItem` 提供——网格只负责状态分发、虚拟化、列宽/定位与页脚，
 * 不含任何领域知识。知识库与模型供应商两个页面此前各自复制了一份（262/232 行里 188 行逐字相同），
 * 复制期间已经漂移（空态文案各改各的、错误态的 ApiError 说明只留在一边）。
 */
export type VirtualCardGridProps<T extends { id: string }> = {
  /** 滚动容器，交给虚拟化作为 scrollElement */
  scrollElement: HTMLElement | null;
  items: T[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** 取下一页失败：页脚就地提示 + 重试（不走整页 isError，避免丢掉已加载的列表） */
  isFetchNextPageError: boolean;
  /** 渲染的是上一组筛选条件的占位数据（keepPreviousData）：列表保持可见，只给轻量加载提示 */
  isPlaceholderData: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  hasFilter: boolean;
  emptyLabel: CardGridEmptyLabel;
  /** 单张卡片：只渲染卡片本身，定位/列宽/行间距由网格统一承担 */
  renderItem: (item: T) => ReactNode;
  /** 挂载时一次性恢复到的首可见项索引（来自会话内视图状态） */
  initialRestoreIndex?: number;
  /** 本次挂载的恢复动作结束（调用方据此清掉锚点，避免重挂时回放） */
  onRestoreDone?: () => void;
  /** 首可见项索引变化回调（滚动中持续上报） */
  onFirstVisibleItemChange?: (index: number) => void;
};

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6'];

/**
 * 加载中：6 个骨架卡片。
 *
 * 刻意**不用 antd `Card`+`Skeleton`**、也刻意**按容器宽度而非视口断点**分列，否则会出现两处
 * jank：一是改用轻量卡片的出发点正是「antd Card 单张约 4-5ms」，骨架反而比卡片还重；
 * 二是视口断点（md/lg/xl）与真实网格的 `computeGridLayout(容器宽度)` 在 1024–1536px 区间会差
 * 一列，冷加载完成瞬间整格跳列。这里复用网格同一套分档与 210px 等高约束。
 */
const CardGridLoading: FC<{ scrollElement: HTMLElement | null }> = ({
  scrollElement,
}) => {
  const { columns, gap } = useGridBreakpoints(scrollElement);
  // 满宽即可：卡片 `100%` 解析到滚动容器的内容盒，PageShell 的内边距已被排除在外
  const width = `calc(${columnWidthOperand(columns, gap)})`;
  return (
    <div className="flex flex-wrap" style={{ paddingTop: GRID_TOP_GAP, gap }}>
      {SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="animate-pulse rounded-lg bg-(--ant-color-fill-quaternary)"
          style={{
            // 与卡片同一套几何：等高（CARD_ESTIMATED_HEIGHT）与同一列宽公式
            height: CARD_ESTIMATED_HEIGHT,
            width,
          }}
        />
      ))}
    </div>
  );
};

const CardGridError: FC<{ error: unknown; onRetry: () => void }> = ({
  error,
  onRetry,
}) => (
  <Result
    status="error"
    title="加载失败"
    // 与其它模块同一约定：只展示服务端业务文案（name === 'ApiError'），
    // 网络中断/脚本异常这类技术报错一律走兜底，不把英文堆栈甩给用户
    subTitle={errorMessageOf(error, '请稍后重试')}
    extra={
      <Button type="link" onClick={onRetry} className="text-sm">
        重试
      </Button>
    }
  />
);

const CardGridEmpty: FC<{ hasFilter: boolean; label: CardGridEmptyLabel }> = ({
  hasFilter,
  label,
}) => (
  <Empty
    className="py-16"
    description={hasFilter ? label.filtered : label.initial}
  />
);

/** 触底加载/换筛选过渡/取下一页失败：三种状态都在页脚就地表达 */
const CardGridFooter: FC<{
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPlaceholderData: boolean;
  isFetchNextPageError: boolean;
  onRetryNextPage: () => void;
}> = ({
  hasNextPage,
  isFetchingNextPage,
  isPlaceholderData,
  isFetchNextPageError,
  onRetryNextPage,
}) => {
  if (isFetchingNextPage || isPlaceholderData) {
    return (
      <div className="flex h-12 items-center justify-center gap-2 py-4">
        <Spin size="small" />
        <span className="text-sm text-gray-400">加载中</span>
      </div>
    );
  }
  // 失败就地提示 + 重试：不能走整页 isError 分支——那会把已经加载好的整屏列表换成错误页，
  // 已加载的分页与滚动位置全丢；同时预取已被 hook 闩住，重试入口只在这里。
  if (isFetchNextPageError) {
    return (
      <div className="flex h-12 items-center justify-center gap-2 py-4">
        <span className="text-sm text-gray-400">加载失败</span>
        <Button type="link" size="small" onClick={onRetryNextPage}>
          重试
        </Button>
      </div>
    );
  }
  if (hasNextPage) return null;
  return (
    <div className="flex h-12 items-center justify-center py-4">
      <span className="text-sm text-gray-400">已加载全部</span>
    </div>
  );
};

/** 虚拟化网格：只渲染可视窗口内的卡片，避免长列表把 DOM 撑爆 */
const CardGridVirtual = <T extends { id: string }>({
  scrollElement,
  items,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  isPlaceholderData,
  fetchNextPage,
  renderItem,
  initialRestoreIndex,
  onRestoreDone,
  onFirstVisibleItemChange,
}: VirtualCardGridProps<T>) => {
  const { layout, virtualItems, totalSize, restorePending } = useVirtualGrid({
    scrollElement,
    count: items.length,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    isPlaceholderData,
    initialRestoreIndex,
    onRestoreDone,
    onFirstVisibleItemChange,
  });

  // 列宽与卡片位置全部交给 CSS calc：内容宽度 = 容器宽度，按列数均分。
  // 这样拖拽窗口时列宽由浏览器重排，不必逐像素经过 React（见 use-virtual-grid 的快照说明）。
  // 表达式与加载骨架共用 grid-layout 的同一份几何。内边距由 PageShell 提供，
  // 虚拟卡片的包含块已是内容盒，故这里不再补 padding（补了会与 PageShell 叠加）。
  const columnWidth = columnWidthOperand(layout.columns, layout.gap);

  return (
    <>
      <div style={{ position: 'relative', height: totalSize }}>
        {/* 恢复未完成（restorePending）时不渲染卡片：此时虚拟化的可视区间还按顶部算，
            先渲染等于白挂一整窗卡片，随后恢复又会挂恢复位置那一窗——两窗白挂一次。
            该分支只在 layout effect 解锁恢复前存在，React 会在绘制前完成重渲染，用户看不到空网格；
            容器高度仍用 totalSize，滚动条与几何不变。 */}
        {restorePending
          ? null
          : virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left:
                      virtualItem.lane === 0
                        ? '0'
                        : `calc(${(virtualItem.lane ?? 0) * layout.gap}px + ${virtualItem.lane} * (${columnWidth}))`,
                    width: `calc(${columnWidth})`,
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: layout.gap,
                  }}
                >
                  {/* 卡片由调用方提供；这里不包箭头函数、不额外引入每次渲染都变化的引用 */}
                  {renderItem(item)}
                </div>
              );
            })}
      </div>
      <CardGridFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isPlaceholderData={isPlaceholderData}
        isFetchNextPageError={isFetchNextPageError}
        onRetryNextPage={fetchNextPage}
      />
    </>
  );
};

/**
 * 按查询状态分发到 加载中 / 失败 / 空 / 虚拟化列表。
 * 各状态拆成独立组件并以扁平 if 返回，避免嵌套三元表达式。
 */
export const VirtualCardGrid = <T extends { id: string }>(
  props: VirtualCardGridProps<T>,
) => {
  if (props.isLoading)
    return <CardGridLoading scrollElement={props.scrollElement} />;
  if (props.isError) {
    return <CardGridError error={props.error} onRetry={props.refetch} />;
  }
  if (props.items.length === 0) {
    return (
      <CardGridEmpty hasFilter={props.hasFilter} label={props.emptyLabel} />
    );
  }
  return <CardGridVirtual {...props} />;
};
