import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullBleedBar } from './full-bleed-bar';

describe('components/FullBleedBar', () => {
  it('挂上通栏底色的 class（底色由 index.css 的 ::before 铺到 100vw）', () => {
    render(<FullBleedBar>内容</FullBleedBar>);
    expect(
      screen.getByText('内容').closest('.lucy-full-bleed-bar'),
    ).toBeInTheDocument();
  });

  it('外层 relative + 内层 flex：底色绝对定位需要 relative 参照', () => {
    render(<FullBleedBar>内容</FullBleedBar>);
    const bar = screen
      .getByText('内容')
      .closest('.lucy-full-bleed-bar') as HTMLElement;
    expect(bar.className).toContain('relative');
    // 控件分布在内层（外层只负责底色通栏，不参与布局撑开）
    const inner = bar.firstElementChild as HTMLElement;
    expect(inner.className).toContain('flex');
    expect(inner.className).toContain('justify-between');
  });

  it('isolate 建立层叠上下文：否则 ::before 的 z-index:-1 冒泡到祖先负层、底色被背景遮住', () => {
    render(<FullBleedBar>内容</FullBleedBar>);
    const bar = screen
      .getByText('内容')
      .closest('.lucy-full-bleed-bar') as HTMLElement;
    // position:relative + z-index:auto 不形成层叠上下文，伪元素负层会向上冒泡，
    // 被祖先不透明背景盖住（实测底色整条不可见）。isolate 是必需项，不可移除。
    expect(bar.className).toContain('isolate');
  });

  it('className / innerClassName 透传', () => {
    render(
      <FullBleedBar className="py-6" innerClassName="px-4">
        内容
      </FullBleedBar>,
    );
    const bar = screen
      .getByText('内容')
      .closest('.lucy-full-bleed-bar') as HTMLElement;
    expect(bar.className).toContain('py-6');
    expect((bar.firstElementChild as HTMLElement).className).toContain('px-4');
  });
});
