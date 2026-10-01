import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './page-shell';

describe('components/PageShell', () => {
  it('默认（content）不接管高度，但提供居中限宽与分档内边距', () => {
    render(<PageShell>内容</PageShell>);
    const shell = screen.getByText('内容');
    expect(shell.className).toContain('max-w-[1600px]');
    expect(shell.className).toContain('mx-auto');
    expect(shell.className).toContain('px-4');
    // content 模式不该写 h-full，否则短内容页会被拉成满高
    expect(shell.className).not.toContain('h-full');
  });

  it('height=fill 时接管剩余高度并建立纵向 flex（供内部滚动容器消费）', () => {
    render(<PageShell height="fill">内容</PageShell>);
    const shell = screen.getByText('内容');
    expect(shell.className).toContain('h-full');
    expect(shell.className).toContain('flex');
    expect(shell.className).toContain('flex-col');
    expect(shell.className).toContain('min-h-0');
  });

  it('bleed 豁免宽度与内边距，但保留高度模式（贴边分栏布局用）', () => {
    render(
      <PageShell height="fill" bleed>
        内容
      </PageShell>,
    );
    const shell = screen.getByText('内容');
    expect(shell.className).not.toContain('max-w-[1600px]');
    expect(shell.className).not.toContain('px-4');
    expect(shell.className).toContain('h-full');
  });

  it('className 透传并覆盖默认（twMerge 去冲突）', () => {
    render(<PageShell className="pt-1">内容</PageShell>);
    const shell = screen.getByText('内容');
    expect(shell.className).toContain('pt-1');
    expect(shell.className).toContain('max-w-[1600px]');
  });
});
