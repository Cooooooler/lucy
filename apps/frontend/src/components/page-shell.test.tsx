import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './page-shell';

describe('components/PageShell', () => {
  it('默认（content）不接管高度，但提供居中限宽与分档内边距', () => {
    render(<PageShell>内容</PageShell>);
    const shell = screen.getByText('内容');
    // 限宽走居中内边距（.lucy-page-gutter）而非 max-w + mx-auto：容器保持满宽，
    // 滚动条才能贴到内容区右缘（见 index.css）
    expect(shell.className).toContain('lucy-page-gutter');
    expect(shell.className).toContain('w-full');
    expect(shell.className).not.toContain('max-w-[1600px]');
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
    expect(shell.className).not.toContain('lucy-page-gutter');
    expect(shell.className).toContain('h-full');
  });

  it('scrollable 时由自身接管纵向滚动（满宽容器，滚动条贴内容区右缘）', () => {
    render(<PageShell scrollable>内容</PageShell>);
    const shell = screen.getByText('内容');
    expect(shell.className).toContain('overflow-y-auto');
    // 没有确定高度就滚不起来：按 fill 处理
    expect(shell.className).toContain('h-full');
    expect(shell.className).toContain('min-h-0');
    // 满宽 + 居中内边距：容器不收窄，滚动条才能贴到内容区右缘
    expect(shell.className).toContain('w-full');
    expect(shell.className).toContain('lucy-page-gutter');
    expect(shell.className).not.toContain('max-w-[1600px]');
    // 滚动容器的子项不能被 flex-shrink 压扁，否则内容撑不开高度、滚不动
    expect(shell.className).not.toContain('flex-col');
  });

  it('把 ref 转发到容器节点（虚拟列表据此把它当 scrollElement）', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <PageShell scrollable ref={ref}>
        内容
      </PageShell>,
    );
    expect(ref.current).toBe(screen.getByText('内容'));
  });

  it('className 透传并覆盖默认（twMerge 去冲突）', () => {
    render(<PageShell className="pt-1">内容</PageShell>);
    const shell = screen.getByText('内容');
    expect(shell.className).toContain('pt-1');
    expect(shell.className).toContain('lucy-page-gutter');
  });
});
