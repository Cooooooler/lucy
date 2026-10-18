import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentToolbar } from './DocumentToolbar';

type ToolbarProps = Parameters<typeof DocumentToolbar>[0];

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    kbName: '产品文档',
    kbDescription: '这是一段描述',
    backLink: <a href="/knowledge">返回</a>,
    onSearch: vi.fn(),
    onUpload: vi.fn(),
    isUploading: false,
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

  it('搜索回调收到 trim 后的关键字', async () => {
    const { props } = renderToolbar();

    await userEvent.type(
      screen.getByPlaceholderText('按文件名或内容搜索'),
      '  正文  ',
    );
    await userEvent.keyboard('{Enter}');

    expect(props.onSearch).toHaveBeenCalledWith('正文');
  });

  it('选择文件后回调 onUpload（beforeUpload 返回 false，不自动发请求）', async () => {
    const { props, container } = renderToolbar();
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['hello'], 'intro.md', { type: 'text/markdown' });

    await userEvent.upload(input as HTMLInputElement, file);

    expect(props.onUpload).toHaveBeenCalledWith(file);
  });

  it('上传入口限定可解析的文档类型', () => {
    const { container } = renderToolbar();

    expect(container.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.txt,.md,.pdf,.docx',
    );
  });

  it('上传中禁用上传按钮（避免并发上传同一个知识库）', () => {
    renderToolbar({ isUploading: true });

    expect(screen.getByRole('button', { name: /上传文档/ })).toBeDisabled();
  });
});
