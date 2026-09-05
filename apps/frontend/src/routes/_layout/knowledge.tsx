import { KnowledgeList } from '@/components/knowledge/KnowledgeList.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useInfiniteScrollContent } from '@/hooks/use-infinite-scroll.tsx';
import { useInfiniteKnowledgeBaseList } from '@/hooks/use-knowledge.ts';
import type { KnowledgeListQuery } from '@lucy/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

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

  const queryState = useInfiniteKnowledgeBaseList(query);

  const { scrollRef, content } = useInfiniteScrollContent({
    query: queryState,
    renderList: (items) => <KnowledgeList knowledgeBases={items} />,
    emptyText: { filtered: '没有匹配的知识库', default: '暂无知识库' },
    hasFilter: Boolean(query?.name || query?.visibility),
  });

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onSearch={setCommittedName}
      />
      {content}
    </div>
  );
}
