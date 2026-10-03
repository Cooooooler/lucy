import { errorMessageOf } from '@/api/client';
import type { ModelProvider } from '@/api/types';
import {
  CARD_ESTIMATED_HEIGHT,
  columnWidthOperand,
  GRID_TOP_GAP,
} from '@/components/grid-layout';
import { ModelProviderCard } from '@/components/model-provider/ModelProviderCard.tsx';
import { useGridBreakpoints, useVirtualGrid } from '@/hooks/use-virtual-grid';
import { Button, Empty, Result, Spin } from 'antd';
import type { FC } from 'react';

/** 正在 pending 的变更操作所对应的模型 id（由路由持有的 mutation 提供，null 表示当前没有） */
export type ModelProviderPendingIds = {
  update: string | null;
  delete: string | null;
  test: string | null;
};

type ModelProviderGridProps = {
  /** 滚动容器，交给虚拟化作为 scrollElement */
  scrollElement: HTMLElement | null;
  items: ModelProvider[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** 取下一页失败：页脚就地提示 + 重试（不走整页 isError） */
  isFetchNextPageError: boolean;
  /** 渲染的是上一组筛选条件的占位数据（keepPreviousData） */
  isPlaceholderData: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  hasFilter: boolean;
  /** 卡片事件与 pending 态由路由持有（卡片保持纯展示） */
  onEdit?: (model: ModelProvider) => void;
  onDelete: (model: ModelProvider) => void;
  onTest: (model: ModelProvider) => void;
  pendingIds: ModelProviderPendingIds;
  /** 挂载时一次性恢复到的首可见项索引（来自会话内视图状态） */
  initialRestoreIndex?: number;
  /** 本次挂载的恢复动作结束（调用方据此清掉锚点） */
  onRestoreDone?: () => void;
  /** 首可见项索引变化回调（滚动中持续上报） */
  onFirstVisibleItemChange?: (index: number) => void;
};

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6'];

/**
 * 加载中：6 个骨架卡片（与知识库网格同款）。
 * 复用同一套几何（分档列数 + 等高约束），冷加载完成瞬间不会跳列/跳高。
 */
const ModelProviderGridLoading: FC<{ scrollElement: HTMLElement | null }> = ({
  scrollElement,
}) => {
  const { columns, gap } = useGridBreakpoints(scrollElement);
  const width = `calc(${columnWidthOperand(columns, gap)})`;
  return (
    <div className="flex flex-wrap" style={{ paddingTop: GRID_TOP_GAP, gap }}>
      {SKELETON_KEYS.map((key) => (
        <div
          key={key}
          className="animate-pulse rounded-lg bg-(--ant-color-fill-quaternary)"
          style={{ height: CARD_ESTIMATED_HEIGHT, width }}
        />
      ))}
    </div>
  );
};

const ModelProviderGridError: FC<{ error: unknown; onRetry: () => void }> = ({
  error,
  onRetry,
}) => (
  <Result
    status="error"
    title="加载失败"
    subTitle={errorMessageOf(error, '请稍后重试')}
    extra={
      <Button type="link" onClick={onRetry} className="text-sm">
        重试
      </Button>
    }
  />
);

const ModelProviderGridEmpty: FC<{ hasFilter: boolean }> = ({ hasFilter }) => (
  <Empty
    className="py-16"
    description={hasFilter ? '没有匹配的模型' : '暂无模型'}
  />
);

/** 触底加载/换筛选过渡/取下一页失败：三种状态都在页脚就地表达 */
const ModelProviderGridFooter: FC<{
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
const ModelProviderGridVirtual: FC<ModelProviderGridProps> = ({
  scrollElement,
  items,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  isPlaceholderData,
  fetchNextPage,
  onEdit,
  onDelete,
  onTest,
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

  const columnWidth = columnWidthOperand(layout.columns, layout.gap);

  return (
    <>
      <div style={{ position: 'relative', height: totalSize }}>
        {restorePending
          ? null
          : virtualItems.map((virtualItem) => {
              const model = items[virtualItem.index];
              if (!model) return null;
              return (
                <div
                  key={model.id}
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
                  <ModelProviderCard
                    model={model}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onTest={onTest}
                    isUpdatePending={pendingIds.update === model.id}
                    isDeletePending={pendingIds.delete === model.id}
                    isTestPending={pendingIds.test === model.id}
                  />
                </div>
              );
            })}
      </div>
      <ModelProviderGridFooter
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
 * 模型网格：按查询状态分发到 加载中 / 失败 / 空 / 虚拟化列表。
 * 各状态拆成独立组件并以扁平 if 返回，避免嵌套三元表达式。
 */
export const ModelProviderGrid: FC<ModelProviderGridProps> = (props) => {
  if (props.isLoading)
    return <ModelProviderGridLoading scrollElement={props.scrollElement} />;
  if (props.isError) {
    return (
      <ModelProviderGridError error={props.error} onRetry={props.refetch} />
    );
  }
  if (props.items.length === 0) {
    return <ModelProviderGridEmpty hasFilter={props.hasFilter} />;
  }
  return <ModelProviderGridVirtual {...props} />;
};
