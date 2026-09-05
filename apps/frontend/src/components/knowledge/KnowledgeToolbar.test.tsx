import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeToolbar, VISIBILITY_OPTIONS } from './KnowledgeToolbar';

/** 渲染 KnowledgeToolbar 的工厂函数，支持配置 visibility 和回调 */
function renderToolbar(
  props: Partial<{
    visibility: 'all' | 'private' | 'public';
    onVisibilityChange: () => void;
    onSearch: (value: string) => void;
  }> = {},
) {
  return render(
    <KnowledgeToolbar
      visibility={props.visibility ?? 'all'}
      onVisibilityChange={props.onVisibilityChange ?? (() => {})}
      onSearch={props.onSearch ?? (() => {})}
    />,
  );
}

describe('KnowledgeToolbar', () => {
  it('渲染三个可见性选项', () => {
    renderToolbar();
    for (const opt of VISIBILITY_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
  });

  it('点击可见性选项触发回调', async () => {
    const onVisibilityChange = vi.fn();
    renderToolbar({ onVisibilityChange });
    await userEvent.click(screen.getByText('公开'));
    expect(onVisibilityChange).toHaveBeenCalledWith('public');
  });

  it('私有选项初始选中时渲染正确', () => {
    renderToolbar({ visibility: 'private' });
    expect(screen.getByText('私有')).toBeInTheDocument();
  });

  it('搜索触发 onSearch 并 trim', async () => {
    const onSearch = vi.fn();
    renderToolbar({ onSearch });
    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.type(input, '  测试  ');
    const buttons = screen.getAllByRole('button');
    const searchButton = buttons.find((b) =>
      b.querySelector('[aria-label="search"]'),
    )!;
    await userEvent.click(searchButton);
    expect(onSearch).toHaveBeenCalledWith('测试');
  });
});
