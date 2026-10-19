import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageToolbar } from './page-toolbar';

describe('components/PageToolbar', () => {
  it('按槽位渲染左侧内容、操作按钮与搜索框', () => {
    render(
      <PageToolbar
        left={<span>筛选</span>}
        actions={<button>新增</button>}
        search={<input placeholder="搜索" />}
      />,
    );

    expect(screen.getByText('筛选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索')).toBeInTheDocument();
  });

  it('操作与搜索都未提供时不渲染右侧操作区', () => {
    const { container } = render(<PageToolbar left={<span>筛选</span>} />);

    expect(screen.getByText('筛选')).toBeInTheDocument();
    expect(container.querySelector('.w-sm')).toBeNull();
  });

  it('只有搜索框时仍渲染右侧操作区', () => {
    const { container } = render(
      <PageToolbar search={<input placeholder="搜索" />} />,
    );

    expect(screen.getByPlaceholderText('搜索')).toBeInTheDocument();
    expect(container.querySelector('.w-sm')).toBeInTheDocument();
  });

  it('只有操作按钮时不套搜索框宽度，右侧保持自然宽度', () => {
    const { container } = render(
      <PageToolbar actions={<button>新增</button>} />,
    );

    const button = screen.getByRole('button', { name: '新增' });
    expect(button).toBeInTheDocument();
    expect(container.querySelector('.w-sm')).toBeNull();
    expect(button.parentElement?.className).toContain('shrink-0');
  });

  it('与 PageShell 平级：不挂 100vw 伪元素，并抬到滚动列表之上', () => {
    render(<PageToolbar left={<span>筛选</span>} />);
    const bar = screen
      .getByText('筛选')
      .closest('.lucy-page-gutter') as HTMLElement;

    expect(bar.className).not.toContain('lucy-full-bleed-bar');
    expect(bar.className).toContain('z-10');
  });
});
