import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelProviderToolbar } from './ModelProviderToolbar';

type ToolbarProps = Parameters<typeof ModelProviderToolbar>[0];

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    type: 'all',
    onTypeChange: vi.fn(),
    onSearch: vi.fn(),
    defaultKeyword: '',
    onCreate: vi.fn(),
    ...overrides,
  };
  return { ...render(<ModelProviderToolbar {...props} />), props };
}

describe('ModelProviderToolbar', () => {
  it('点击「新增模型」触发 onCreate', async () => {
    const { props } = renderToolbar();
    await userEvent.click(screen.getByText('新增模型'));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it('搜索会 trim 后上报', async () => {
    const { props } = renderToolbar();
    await userEvent.type(
      screen.getByPlaceholderText('按名称搜索模型'),
      '  gpt  {Enter}',
    );
    expect(props.onSearch).toHaveBeenCalledWith('gpt');
  });

  it('切换类型过滤上报对应值', async () => {
    const { props } = renderToolbar();
    await userEvent.click(screen.getByText('文本嵌入'));
    expect(props.onTypeChange).toHaveBeenCalledWith('text-embedding');
  });

  it('defaultKeyword 作为搜索框初始值', () => {
    renderToolbar({ defaultKeyword: 'gpt' });
    expect(screen.getByPlaceholderText('按名称搜索模型')).toHaveValue('gpt');
  });

  it('工具条与 PageShell 平级：不挂 100vw 伪元素（副菜单下底色会溢进副菜单列）', () => {
    renderToolbar();
    expect(
      screen.getByText('新增模型').closest('.lucy-full-bleed-bar'),
    ).toBeNull();
  });

  it('抬到滚动列表之上（z-10）：否则列表项按树序盖住 shadow-lg', () => {
    renderToolbar();
    const bar = screen.getByText('新增模型').closest('.lucy-page-gutter');
    expect(bar?.className).toContain('z-10');
  });
});
