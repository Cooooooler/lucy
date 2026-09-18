import type { KnowledgeBase } from '@/api/types.ts';
import { KnowledgeFormDrawer } from '@/components/knowledge/KnowledgeFormDrawer.tsx';
import { KnowledgeGrid } from '@/components/knowledge/KnowledgeGrid.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state.ts';
import {
  type KnowledgeListFilter,
  useInfiniteKnowledgeBaseList,
} from '@/hooks/use-knowledge.ts';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeComponent,
});

function KnowledgeComponent() {
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useKnowledgeViewState();

  // 恢复锚点只在路由本次挂载后消费一次：恢复完成后置 0。
  // 必须由路由持有而非网格自己记账——改筛选会切到新 queryKey（isLoading）导致
  // KnowledgeGridVirtual 卸载重挂，网格内的「已恢复」标记会随实例归零，
  // 于是旧锚点被再次回放，把事件处理器里的 scrollTo({ top: 0 }) 覆盖掉。
  const [restoreIndex, setRestoreIndex] = useState(initialRestoreIndex);
  const handleRestoreDone = useCallback(() => setRestoreIndex(0), []);

  // 初值来自会话 store：SPA 返回时自动还原上次筛选
  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [visibility, setVisibility] = useState<VisibilityFilter>(
    initialFilter.visibility ?? 'all',
  );
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  /** 单例表单抽屉的目标：create / edit(kb) / 关闭(null) */
  const [formTarget, setFormTarget] = useState<
    { mode: 'create' } | { mode: 'edit'; kb: KnowledgeBase } | null
  >(null);

  const filter = useMemo<KnowledgeListFilter>(
    () => ({
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const query = useInfiniteKnowledgeBaseList(filter);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.list) ?? [],
    [query.data],
  );

  // 回调用 useCallback 包裹只是让引用在「未经 React Compiler 的路径」（vitest、
  // 未启用 compiler 的 dev 配置）下也保持稳定；构建产物里 Compiler 已做细粒度 memo。
  // 不是正确性前提——卡片不再依赖 memo 包裹，回调换成新引用也不会导致重放或错渲染。
  const handleEdit = useCallback(
    (kb: KnowledgeBase) => setFormTarget({ mode: 'edit', kb }),
    [],
  );
  const handleCreate = useCallback(() => setFormTarget({ mode: 'create' }), []);

  // 改筛选后回到列表顶部：直接写进改变筛选的两个用户事件里，不再用 filterKey 派生值 + effect。
  // 筛选只可能由这两个事件改变，用 effect 比对「上一次 key」是对同一动作的重复建模，
  // 还多一趟 effect 与一个纯记账 ref。放进事件处理器天然满足「挂载时不归零」
  // （挂载不触发这两个处理器），因此不会与首可见项恢复互相打架。
  const handleSearch = useCallback(
    (value: string) => {
      setCommittedName(value);
      saveFilter({ name: value || undefined });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  const handleVisibilityChange = useCallback(
    (value: VisibilityFilter) => {
      setVisibility(value);
      saveFilter({ visibility: value === 'all' ? undefined : value });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  return (
    <div className="flex h-full flex-col">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        onSearch={handleSearch}
        defaultKeyword={initialFilter.name ?? ''}
        onCreate={handleCreate}
      />
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto">
        <KnowledgeGrid
          scrollElement={scrollElement}
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          refetch={query.refetch}
          hasFilter={Boolean(filter.name || filter.visibility)}
          onEdit={handleEdit}
          initialRestoreIndex={restoreIndex}
          onRestoreDone={handleRestoreDone}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
      </div>
      <KnowledgeFormDrawer
        open={!!formTarget}
        mode={formTarget?.mode ?? 'create'}
        kb={formTarget?.mode === 'edit' ? formTarget.kb : undefined}
        onClose={() => setFormTarget(null)}
      />
    </div>
  );
}
