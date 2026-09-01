import { KnowledgeList } from '@/components/knowledge/KnowledgeList.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useInfiniteKnowledgeBaseList } from '@/hooks/use-knowledge.ts';
import type { KnowledgeListQuery } from '@lucy/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useInViewport } from 'ahooks';
import { useEffect, useMemo, useRef, useState } from 'react';

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeComponent,
});

function KnowledgeComponent() {
  const [committedName, setCommittedName] = useState('');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');

  const query = useMemo<KnowledgeListQuery>(
    () => ({
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const parentRef = useRef<HTMLDivElement | null>(null);
  const childrenRef = useRef<HTMLDivElement | null>(null);

  const [inViewport] = useInViewport(() => childrenRef.current, {
    rootMargin: '250px', // 距离视口底部250px就触发，不要等元素完全进入
    threshold: [0, 0.25, 0.5, 0.75, 1],
    root: () => parentRef.current,
  });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteKnowledgeBaseList(query);
  const allItems = data?.pages.flatMap((p) => p.list) ?? [];

  // 触发加载逻辑
  useEffect(() => {
    // 条件：哨兵进入视口、有下一页、当前不在加载
    if (inViewport && hasNextPage && !isFetchingNextPage && !isLoading) {
      void fetchNextPage();
    }
  }, [inViewport, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading]);
  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onSearch={setCommittedName}
      />
      <KnowledgeList knowledgeBases={allItems} />
      <div ref={childrenRef}></div>
    </div>
  );
}
