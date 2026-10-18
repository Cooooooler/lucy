import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CardShell } from './CardShell';

describe('CardShell', () => {
  it('未传 openLink 时不渲染热区（模型供应商卡片不受影响）', () => {
    const { container } = render(<CardShell title="产品文档">正文</CardShell>);
    expect(container.querySelector('a')).toBeNull();
  });

  it('openLink 渲染为整卡的首个子元素（DOM 顺序在角标与操作栏之前）', () => {
    render(
      <CardShell
        title="产品文档"
        openLink={
          <a href="/knowledge/kb1" className="absolute inset-0">
            打开
          </a>
        }
        badge={<button type="button">公开</button>}
        actions={<button type="button">删除</button>}
      >
        正文
      </CardShell>,
    );

    const link = screen.getByRole('link', { name: '打开' });
    const card = link.parentElement;
    expect(card).not.toBeNull();
    // 首个子元素 = 热区：角标与操作栏在其后且有定位，绘制顺序天然压住它
    expect(card?.firstElementChild).toBe(link);
    // 覆盖整卡靠调用方给的定位类（本组件不动传入的节点）
    expect(link).toHaveClass('absolute', 'inset-0');
  });

  it('角标与操作栏的点击不会被热区吃掉（无需 stopPropagation）', async () => {
    const onBadge = vi.fn();
    const onAction = vi.fn();
    render(
      <CardShell
        title="产品文档"
        openLink={<a href="/knowledge/kb1">打开</a>}
        badge={
          <button type="button" onClick={onBadge}>
            公开
          </button>
        }
        actions={
          <button type="button" onClick={onAction}>
            删除
          </button>
        }
      >
        正文
      </CardShell>,
    );

    await userEvent.click(screen.getByRole('button', { name: '公开' }));
    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onBadge).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
