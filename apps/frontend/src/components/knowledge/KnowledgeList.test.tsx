import type { KnowledgeBase } from '@/api/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KnowledgeList } from './KnowledgeList';

function makeKb(id: string, name: string): KnowledgeBase {
  return {
    id,
    ownerId: 'u1',
    visibility: 'private',
    name,
    description: `${name} 的描述`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('KnowledgeList', () => {
  it('渲染多个知识库卡片', () => {
    const items = [makeKb('kb1', '知识库 A'), makeKb('kb2', '知识库 B')];
    render(<KnowledgeList knowledgeBases={items} />);
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
    expect(screen.getByText('知识库 B')).toBeInTheDocument();
  });

  it('空数组时不渲染任何卡片', () => {
    const { container } = render(<KnowledgeList knowledgeBases={[]} />);
    expect(container.querySelectorAll('.ant-card')).toHaveLength(0);
  });
});
