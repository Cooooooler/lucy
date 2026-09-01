import type { KnowledgeBase } from '@/api/types.ts';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard.tsx';
import type { FC } from 'react';

export const KnowledgeList: FC<{ knowledgeBases: KnowledgeBase[] }> = ({
  knowledgeBases,
}) => {
  return (
    <div className="box-border grid grid-cols-1 gap-4 px-4 pt-4 pb-8 sm:grid-cols-1 sm:px-6 md:grid-cols-1 md:px-8 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {knowledgeBases.map((kb) => (
        <KnowledgeCard kb={kb} key={kb.id} />
      ))}
    </div>
  );
};
