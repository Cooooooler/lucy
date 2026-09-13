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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const filterKey = `${committedName}|${visibility}`;
  const prevFilterKeyRef = useRef(filterKey);

  // 只在筛选真正变化时回顶部。挂载时不动：挂载归零会与首可见项恢复互相打架
  useEffect(() => {
    if (prevFilterKeyRef.current === filterKey) return;
    prevFilterKeyRef.current = filterKey;
    scrollElement?.scrollTo({ top: 0 });
  }, [filterKey, scrollElement]);

  // 稳定引用：传给虚拟化网格/工具栏的回调必须用 useCallback 包裹，
  // 否则每次渲染都是新函数，会让 KnowledgeCard 的 React.memo 永久失效（第二趟渲染无法 bail out）。
  const handleEdit = useCallback(
    (kb: KnowledgeBase) => setFormTarget({ mode: 'edit', kb }),
    [],
  );
  const handleCreate = useCallback(() => setFormTarget({ mode: 'create' }), []);

  const handleSearch = (value: string) => {
    setCommittedName(value);
    saveFilter({ name: value || undefined });
  };

  const handleVisibilityChange = (value: VisibilityFilter) => {
    setVisibility(value);
    saveFilter({ visibility: value === 'all' ? undefined : value });
  };

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
          initialRestoreIndex={initialRestoreIndex}
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
