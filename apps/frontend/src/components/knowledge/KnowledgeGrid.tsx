import type { KnowledgeBase } from '@/api/types';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard.tsx';
import { useVirtualGrid } from '@/hooks/use-virtual-grid';
import { Button, Card, Empty, Result, Skeleton, Spin } from 'antd';
import type { FC } from 'react';

type KnowledgeGridProps = {
  /** 滚动容器，交给虚拟化作为 scrollElement */
  scrollElement: HTMLElement | null;
  items: KnowledgeBase[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  hasFilter: boolean;
  /** 点击卡片「编辑」时上报意图；表单抽屉由路由持有 */
  onEdit?: (kb: KnowledgeBase) => void;
  /** 挂载时一次性恢复到的首可见项索引（来自会话内视图状态） */
  initialRestoreIndex?: number;
  /** 本次挂载的恢复动作结束（调用方据此清掉锚点，避免重挂时回放） */
  onRestoreDone?: () => void;
  /** 首可见项索引变化回调（滚动中持续上报） */
  onFirstVisibleItemChange?: (index: number) => void;
};

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5', 'sk-6'];

/** 加载中：6 个骨架卡片（与卡片网格同构） */
const KnowledgeGridLoading: FC = () => (
  <div className="grid grid-cols-1 gap-4 px-4 pt-4 pb-8 sm:grid-cols-1 sm:px-6 md:grid-cols-2 md:px-8 lg:grid-cols-3 xl:grid-cols-4">
    {SKELETON_KEYS.map((key) => (
      <Card key={key} variant="borderless">
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    ))}
  </div>
);

const KnowledgeGridError: FC<{ error: unknown; onRetry: () => void }> = ({
  error,
  onRetry,
}) => (
  <Result
    status="error"
    title="加载失败"
    subTitle={error instanceof Error ? error.message : '请稍后重试'}
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

/** 触底加载状态：加载中 / 已加载全部 */
const KnowledgeGridFooter: FC<{
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}> = ({ hasNextPage, isFetchingNextPage }) => {
  if (isFetchingNextPage) {
    return (
      <div className="flex h-12 items-center justify-center gap-2 py-4">
        <Spin size="small" />
        <span className="text-sm text-gray-400">加载中</span>
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
  fetchNextPage,
  onEdit,
  initialRestoreIndex,
  onRestoreDone,
  onFirstVisibleItemChange,
}) => {
  const { layout, virtualItems, totalSize, restorePending } = useVirtualGrid({
    scrollElement,
    count: items.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    initialRestoreIndex,
    onRestoreDone,
    onFirstVisibleItemChange,
  });

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
                    left:
                      layout.padding +
                      (virtualItem.lane ?? 0) *
                        (layout.columnWidth + layout.gap),
                    width: layout.columnWidth,
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: layout.gap,
                  }}
                >
                  {/* 原样透传 onEdit（不包箭头函数），不额外引入每次渲染都变化的引用；
                  可空处理留在卡片内部（onEdit?.()） */}
                  <KnowledgeCard kb={kb} onEdit={onEdit} />
                </div>
              );
            })}
      </div>
      <KnowledgeGridFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    </>
  );
};

/**
 * 知识库网格：按查询状态分发到 加载中 / 失败 / 空 / 虚拟化列表。
 * 各状态拆成独立组件并以扁平 if 返回，避免嵌套三元表达式。
 */
export const KnowledgeGrid: FC<KnowledgeGridProps> = (props) => {
  if (props.isLoading) return <KnowledgeGridLoading />;
  if (props.isError) {
    return <KnowledgeGridError error={props.error} onRetry={props.refetch} />;
  }
  if (props.items.length === 0) {
    return <KnowledgeGridEmpty hasFilter={props.hasFilter} />;
  }
  return <KnowledgeGridVirtual {...props} />;
};
