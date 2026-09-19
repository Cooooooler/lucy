import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeCard } from './KnowledgeCard';
import { baseKb } from './knowledge-test-fixture';

type CardProps = ComponentProps<typeof KnowledgeCard>;

function renderCard(overrides: Partial<CardProps> = {}) {
  const props: CardProps = {
    kb: baseKb,
    onEdit: vi.fn(),
    onToggleLike: vi.fn(),
    onToggleVisibility: vi.fn(),
    onDelete: vi.fn(),
    isLikePending: false,
    isUpdatePending: false,
    isDeletePending: false,
    ...overrides,
  };
  return { ...render(<KnowledgeCard {...props} />), props };
}

describe('KnowledgeCard', () => {
  it('渲染知识库名称', () => {
    renderCard();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
  });

  it('标题渲染为单行省略（truncate + 原生 title 全名）', () => {
    renderCard();

    const titleRow = screen.getByTitle('产品文档');
    expect(titleRow).toBeInTheDocument();
    // 标题行固定高度（h-[46px]）是卡片等高（CARD_ESTIMATED_HEIGHT=210）的前提
    expect(titleRow).toHaveClass('h-[46px]');

    const nameSpan = titleRow.querySelector('span');
    expect(nameSpan).toHaveTextContent('产品文档');
    expect(nameSpan).toHaveClass('truncate');
  });

  it('渲染描述文本', () => {
    renderCard();
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
  });

  it('描述区为纯 CSS 两行截断（h-11 + line-clamp-2 + 原生 title），不再挂 Typography.Paragraph', () => {
    const { container } = renderCard();

    const desc = screen.getByText('这是一段描述');
    expect(desc.tagName).toBe('DIV');
    // h-11 是卡片等高的前提（CARD_ESTIMATED_HEIGHT 硬约束），必须保留
    expect(desc).toHaveClass('h-11');
    expect(desc).toHaveClass('line-clamp-2');
    expect(desc).toHaveAttribute('title', '这是一段描述');
    // 不再渲染 antd Typography（rc-text 测量）结构
    expect(container.querySelector('.ant-typography')).toBeNull();
  });

  it('描述为 null 时不渲染空 tooltip（无 title 属性）', () => {
    const { container } = renderCard({ kb: { ...baseKb, description: null } });

    const desc = container.querySelector('.line-clamp-2');
    expect(desc).not.toBeNull();
    expect(desc).not.toHaveAttribute('title');
    expect(desc?.textContent).toBe('');
  });

  it('操作按钮改用原生 title（不再包 antd Tooltip / rc-trigger）', () => {
    renderCard();

    // aria-label 仍驱动可访问名（下面单独断言），title 提供 hover 文案
    expect(screen.getByRole('button', { name: '点赞' })).toHaveAttribute(
      'title',
      '点赞',
    );
    expect(screen.getByRole('button', { name: '设为公开' })).toHaveAttribute(
      'title',
      '设为公开',
    );
    expect(screen.getByRole('button', { name: '编辑知识库' })).toHaveAttribute(
      'title',
      '编辑知识库',
    );
    expect(screen.getByRole('button', { name: '删除知识库' })).toHaveAttribute(
      'title',
      '删除知识库',
    );
  });

  it('点击「编辑知识库」以该卡片调用 onEdit（抽屉由路由持有）', async () => {
    const { props } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(props.onEdit).toHaveBeenCalledWith(baseKb);
    // 卡片不再自持编辑抽屉
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
  });

  it('未传 onEdit 时点击编辑按钮不抛错', async () => {
    renderCard({ onEdit: undefined });

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));
  });

  it('点赞按钮只上报意图（mutation 由路由持有）', async () => {
    const { props } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: '点赞' }));

    expect(props.onToggleLike).toHaveBeenCalledWith(baseKb);
    expect(props.onToggleVisibility).not.toHaveBeenCalled();
  });

  it('已点赞时按钮为「取消点赞」，同样只上报同一个意图回调', async () => {
    const kb = { ...baseKb, isLiked: true, likeCount: 5 };
    const { props } = renderCard({ kb });

    await userEvent.click(screen.getByRole('button', { name: '取消点赞' }));

    expect(props.onToggleLike).toHaveBeenCalledWith(kb);
  });

  it('已点赞时显示点赞数', () => {
    renderCard({ kb: { ...baseKb, isLiked: true, likeCount: 42 } });

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('可见性按钮上报切换意图（私有 → 设为公开）', async () => {
    const { props } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    expect(props.onToggleVisibility).toHaveBeenCalledWith(baseKb);
  });

  it('公开库按钮为「设为私有」', async () => {
    const kb = { ...baseKb, visibility: 'public' as const };
    const { props } = renderCard({ kb });

    await userEvent.click(screen.getByRole('button', { name: '设为私有' }));

    expect(props.onToggleVisibility).toHaveBeenCalledWith(kb);
  });

  it('删除按钮只上报意图：确认对话框由路由持有，卡片内不再弹窗', async () => {
    const { props } = renderCard();

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

    expect(props.onDelete).toHaveBeenCalledWith(baseKb);
    expect(
      screen.queryByText('确定要删除知识库「产品文档」吗？此操作不可恢复。'),
    ).not.toBeInTheDocument();
  });

  it('对应操作 pending 时按钮禁用（点赞/可见性/删除互不影响）', () => {
    renderCard({
      isLikePending: true,
      isUpdatePending: true,
      isDeletePending: true,
    });

    expect(screen.getByRole('button', { name: '点赞' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '设为公开' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除知识库' })).toBeDisabled();
    // 编辑不涉及写操作，保持可用
    expect(screen.getByRole('button', { name: '编辑知识库' })).toBeEnabled();
  });
});
