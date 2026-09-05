import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeToolbar, VISIBILITY_OPTIONS } from './KnowledgeToolbar';

describe('KnowledgeToolbar', () => {
  it('渲染三个可见性选项', () => {
    render(
      <KnowledgeToolbar
        visibility="all"
        onVisibilityChange={() => {}}
        onSearch={() => {}}
      />,
    );
    for (const opt of VISIBILITY_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
  });

  it('点击可见性选项触发回调', async () => {
    const onVisibilityChange = vi.fn();
    render(
      <KnowledgeToolbar
        visibility="all"
        onVisibilityChange={onVisibilityChange}
        onSearch={() => {}}
      />,
    );
    await userEvent.click(screen.getByText('公开'));
    expect(onVisibilityChange).toHaveBeenCalledWith('public');
  });

  it('搜索触发 onSearch 并 trim', async () => {
    const onSearch = vi.fn();
    render(
      <KnowledgeToolbar
        visibility="all"
        onVisibilityChange={() => {}}
        onSearch={onSearch}
      />,
    );
    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.type(input, '  测试  ');
    // antd Input.Search 的搜索按钮通过内部图标 aria-label=search 定位
    const buttons = screen.getAllByRole('button');
    const searchButton = buttons.find((b) =>
      b.querySelector('[aria-label="search"]'),
    )!;
    await userEvent.click(searchButton);
    expect(onSearch).toHaveBeenCalledWith('测试');
  });
});
