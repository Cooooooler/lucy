import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeToolbar, VISIBILITY_OPTIONS } from './KnowledgeToolbar';

/** 渲染 KnowledgeToolbar 的工厂函数，包裹 AntdApp 以承载 message 上下文 */
function renderToolbar(
  props: Partial<{
    visibility: 'all' | 'private' | 'public';
    onVisibilityChange: () => void;
    onSearch: (value: string) => void;
    defaultKeyword?: string;
    onCreate: () => void;
  }> = {},
) {
  return render(
    <AntdApp>
      <KnowledgeToolbar
        visibility={props.visibility ?? 'all'}
        onVisibilityChange={props.onVisibilityChange ?? (() => {})}
        onSearch={props.onSearch ?? (() => {})}
        defaultKeyword={props.defaultKeyword}
        onCreate={props.onCreate ?? (() => {})}
      />
    </AntdApp>,
  );
}

describe('KnowledgeToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('点击「新增知识库」触发 onCreate（抽屉由路由持有）', async () => {
    const onCreate = vi.fn();
    renderToolbar({ onCreate });
    await userEvent.click(screen.getByText('新增知识库'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('工具栏不再自持表单抽屉', async () => {
    renderToolbar();
    await userEvent.click(screen.getByText('新增知识库'));
    expect(screen.queryByText('名称')).not.toBeInTheDocument();
    expect(screen.queryByText('描述')).not.toBeInTheDocument();
    expect(screen.queryByText('可见性')).not.toBeInTheDocument();
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

  it('defaultKeyword 作为搜索框初始值（返回恢复）', () => {
    renderToolbar({ defaultKeyword: '产品' });
    expect(screen.getByPlaceholderText('按名称搜索知识库')).toHaveValue('产品');
  });
});
