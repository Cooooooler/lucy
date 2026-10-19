import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentToolbar } from './DocumentToolbar';

type ToolbarProps = Parameters<typeof DocumentToolbar>[0];

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    kbName: '产品文档',
    kbDescription: '这是一段描述',
    backLink: <a href="/knowledge">返回</a>,
    ...overrides,
  };
  return { ...render(<DocumentToolbar {...props} />), props };
}

describe('DocumentToolbar', () => {
  it('展示知识库名称与描述，并渲染路由注入的返回入口', () => {
    renderToolbar();

    expect(screen.getByText('产品文档')).toBeInTheDocument();
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回' })).toHaveAttribute(
      'href',
      '/knowledge',
    );
  });

  it('知识库信息未就绪时占位，不渲染空标题', () => {
    renderToolbar({ kbName: undefined, kbDescription: undefined });

    expect(screen.getByText('知识库')).toBeInTheDocument();
  });

  it('描述为空时不渲染描述行', () => {
    renderToolbar({ kbDescription: undefined });

    expect(screen.queryByText('这是一段描述')).not.toBeInTheDocument();
  });
});
