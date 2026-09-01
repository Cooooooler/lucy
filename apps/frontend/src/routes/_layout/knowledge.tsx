import { KnowledgeList } from '@/components/knowledge/KnowledgeList.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useKnowledgeBaseList } from '@/hooks/use-knowledge.ts';
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
      pageSize: 100,
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const knowledgeBases = useKnowledgeBaseList(query);

  return (
    <div className="h-full overflow-y-auto">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onSearch={setCommittedName}
      />
      <KnowledgeList knowledgeBases={knowledgeBases.data?.list || []} />
    </div>
  );
}
