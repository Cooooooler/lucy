import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KnowledgeCard } from './KnowledgeCard';
import { baseKb } from './knowledge-test-fixture';

describe('KnowledgeCard', () => {
  it('渲染知识库名称', () => {
    render(<KnowledgeCard kb={baseKb} />);
    expect(screen.getByText('产品文档')).toBeInTheDocument();
  });

  it('渲染描述文本', () => {
    render(<KnowledgeCard kb={baseKb} />);
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
  });

  it('渲染详情按钮', () => {
    render(<KnowledgeCard kb={baseKb} />);
    expect(screen.getByText('详情')).toBeInTheDocument();
  });
});
