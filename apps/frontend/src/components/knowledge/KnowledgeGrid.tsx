import { errorMessageOf } from '@/api/client';
import type { KnowledgeBase } from '@/api/types';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard.tsx';
import { CARD_ESTIMATED_HEIGHT } from '@/components/knowledge/grid-layout';
import { useGridBreakpoints, useVirtualGrid } from '@/hooks/use-virtual-grid';
import { Button, Empty, Result, Spin } from 'antd';
import type { FC } from 'react';

/** 正在 pending 的变更操作所对应的知识库 id（由路由持有的 mutation 提供，null 表示当前没有） */
export type KnowledgePendingIds = {
  like: string | null;
  update: string | null;
  delete: string | null;
};

type KnowledgeGridProps = {
  /** 滚动容器，交给虚拟化作为 scrollElement */
  scrollElement: HTMLElement | null;
  items: KnowledgeBase[];
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
  /** 卡片事件与 pending 态由路由持有（卡片保持纯展示，不各自实例化 mutation） */
  onEdit?: (kb: KnowledgeBase) => void;
  onToggleLike: (kb: KnowledgeBase) => void;
  onToggleVisibility: (kb: KnowledgeBase) => void;
  onDelete: (kb: KnowledgeBase) => void;
  pendingIds: KnowledgePendingIds;
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
 * jank：一是本次改造的出发点正是「antd Card 单张约 4-5ms」，骨架反而比卡片还重；
 * 二是视口断点（md/lg/xl）与真实网格的 `computeGridLayout(容器宽度)` 在 1024–1536px 区间会差
 * 一列，冷加载完成瞬间整格跳列。这里复用网格同一套分档与 210px 等高约束。
 */
const KnowledgeGridLoading: FC<{ scrollElement: HTMLElement | null }> = ({
  scrollElement,
}) => {
  const { columns, padding, gap } = useGridBreakpoints(scrollElement);
  return (
    <div
      className="flex flex-wrap"
      style={{ paddingLeft: padding, paddingRight: padding, gap }}
    >
      {SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="animate-pulse rounded-lg bg-(--ant-color-fill-quaternary)"
          style={{
            // 与卡片同一套几何：等高（CARD_ESTIMATED_HEIGHT）与同一列宽公式
            height: CARD_ESTIMATED_HEIGHT,
            width: `calc((100% - ${padding * 2 + gap * (columns - 1)}px) / ${columns})`,
          }}
        />
      ))}
    </div>
  );
};

const KnowledgeGridError: FC<{ error: unknown; onRetry: () => void }> = ({
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

const KnowledgeGridEmpty: FC<{ hasFilter: boolean }> = ({ hasFilter }) => (
  <Empty
    className="py-16"
    description={hasFilter ? '没有匹配的知识库' : '暂无知识库'}
  />
);

/** 触底加载/换筛选过渡/取下一页失败：三种状态都在页脚就地表达 */
const KnowledgeGridFooter: FC<{
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
const KnowledgeGridVirtual: FC<KnowledgeGridProps> = ({
  scrollElement,
  items,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  isPlaceholderData,
  fetchNextPage,
  onEdit,
  onToggleLike,
  onToggleVisibility,
  onDelete,
  pendingIds,
  initialRestoreIndex,
  onRestoreDone,
  onFirstVisibleItemChange,
}) => {
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

  // 列宽与卡片位置全部交给 CSS calc：内容宽度 = 容器宽度 − 左右内边距，再按列数均分。
  // 这样拖拽窗口时列宽由浏览器重排，不必逐像素经过 React（见 use-virtual-grid 的快照说明）。
  const columnWidth = `(100% - ${layout.padding * 2 + layout.gap * (layout.columns - 1)}px) / ${layout.columns}`;

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
              const kb = items[virtualItem.index];
              if (!kb) return null;
              return (
                <div
                  key={kb.id}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: `calc(${layout.padding}px + ${virtualItem.lane ?? 0} * (${columnWidth} + ${layout.gap}px))`,
                    width: `calc(${columnWidth})`,
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: layout.gap,
                  }}
                >
                  {/* 原样透传回调（不包箭头函数），不额外引入每次渲染都变化的引用；
                  可空处理留在卡片内部（onEdit?.()） */}
                  <KnowledgeCard
                    kb={kb}
                    onEdit={onEdit}
                    onToggleLike={onToggleLike}
                    onToggleVisibility={onToggleVisibility}
                    onDelete={onDelete}
                    isLikePending={pendingIds.like === kb.id}
                    isUpdatePending={pendingIds.update === kb.id}
                    isDeletePending={pendingIds.delete === kb.id}
                  />
                </div>
              );
            })}
      </div>
      <KnowledgeGridFooter
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
 * 知识库网格：按查询状态分发到 加载中 / 失败 / 空 / 虚拟化列表。
 * 各状态拆成独立组件并以扁平 if 返回，避免嵌套三元表达式。
 */
export const KnowledgeGrid: FC<KnowledgeGridProps> = (props) => {
  if (props.isLoading)
    return <KnowledgeGridLoading scrollElement={props.scrollElement} />;
  if (props.isError) {
    return <KnowledgeGridError error={props.error} onRetry={props.refetch} />;
  }
  if (props.items.length === 0) {
    return <KnowledgeGridEmpty hasFilter={props.hasFilter} />;
  }
  return <KnowledgeGridVirtual {...props} />;
};
