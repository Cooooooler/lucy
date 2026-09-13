import { ApiError } from '@/api/client';
import {
  useDeleteKnowledgeBase,
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeCard } from './KnowledgeCard';
import { baseKb } from './knowledge-test-fixture';

vi.mock('@/hooks/use-knowledge', () => ({
  useUpdateKnowledgeBase: vi.fn(),
  useLikeKnowledgeBase: vi.fn(),
  useUnlikeKnowledgeBase: vi.fn(),
  useDeleteKnowledgeBase: vi.fn(),
}));

const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);
const mockedLike = vi.mocked(useLikeKnowledgeBase);
const mockedUnlike = vi.mocked(useUnlikeKnowledgeBase);
const mockedDelete = vi.mocked(useDeleteKnowledgeBase);

function updateMutationMock(
  overrides: Partial<ReturnType<typeof useUpdateKnowledgeBase>> = {},
) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useUpdateKnowledgeBase>;
}

function noopMutationMock() {
  return {
    mutate: vi.fn(),
    isPending: false,
    mutateAsync: vi.fn(),
    data: undefined,
    error: null,
    isSuccess: false,
    isError: false,
    isIdle: true,
    reset: vi.fn(),
    status: 'idle',
    variables: undefined,
    context: undefined,
    submittedAt: 0,
    failureCount: 0,
    failureReason: null,
  } as unknown as ReturnType<typeof useLikeKnowledgeBase> &
    ReturnType<typeof useUnlikeKnowledgeBase>;
}

function deleteMutationMock() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteKnowledgeBase>;
}

function renderCard(
  kb = baseKb,
  likeMock: ReturnType<typeof noopMutationMock> | null = null,
  unlikeMock: ReturnType<typeof noopMutationMock> | null = null,
  deleteMock: ReturnType<typeof deleteMutationMock> | null = null,
  onEdit: (kb: typeof baseKb) => void = () => {},
) {
  mockedLike.mockReturnValue(likeMock ?? noopMutationMock());
  mockedUnlike.mockReturnValue(unlikeMock ?? noopMutationMock());
  mockedDelete.mockReturnValue(deleteMock ?? deleteMutationMock());
  return render(
    <AntdApp>
      <KnowledgeCard kb={kb} onEdit={onEdit} />
    </AntdApp>,
  );
}

describe('KnowledgeCard', () => {
  it('用 React.memo 包裹（虚拟化挂载后的第二趟渲染可整体 bail out）', () => {
    expect((KnowledgeCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });

  it('渲染知识库名称', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
  });

  it('标题渲染为单行省略（truncate + 原生 title 全名）', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
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
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
  });

  it('描述区为纯 CSS 两行截断（h-11 + line-clamp-2 + 原生 title），不再挂 Typography.Paragraph', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
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
    mockedUpdate.mockReturnValue(updateMutationMock());
    const { container } = renderCard({ ...baseKb, description: null });

    const desc = container.querySelector('.line-clamp-2');
    expect(desc).not.toBeNull();
    expect(desc).not.toHaveAttribute('title');
    expect(desc?.textContent).toBe('');
  });

  it('渲染点赞按钮', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByRole('button', { name: '点赞' })).toBeInTheDocument();
  });

  it('操作按钮改用原生 title（不再包 antd Tooltip / rc-trigger）', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
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
    mockedUpdate.mockReturnValue(updateMutationMock());
    const onEdit = vi.fn();
    renderCard(baseKb, null, null, null, onEdit);

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(onEdit).toHaveBeenCalledWith(baseKb);
    // 卡片不再自持编辑抽屉
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
  });

  it('未点赞时点击点赞按钮调用 like', async () => {
    const likeMock = noopMutationMock();
    const unlikeMock = noopMutationMock();
    renderCard(baseKb, likeMock, unlikeMock);

    await userEvent.click(screen.getByRole('button', { name: '点赞' }));
    expect(likeMock.mutate).toHaveBeenCalledWith('kb1');
    expect(unlikeMock.mutate).not.toHaveBeenCalled();
  });

  it('已点赞时点击取消点赞按钮调用 unlike', async () => {
    const likeMock = noopMutationMock();
    const unlikeMock = noopMutationMock();
    renderCard(
      { ...baseKb, isLiked: true, likeCount: 5 },
      likeMock,
      unlikeMock,
    );

    await userEvent.click(screen.getByRole('button', { name: '取消点赞' }));
    expect(unlikeMock.mutate).toHaveBeenCalledWith('kb1');
    expect(likeMock.mutate).not.toHaveBeenCalled();
  });

  it('已点赞时显示点赞数', async () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard({
      ...baseKb,
      isLiked: true,
      likeCount: 42,
    });

    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('私有知识库点击切换按钮设为公开', async () => {
    const mutateAsync = vi.fn(async () => ({
      id: 'kb1',
      ownerId: 'u1',
      visibility: 'public' as const,
      name: '产品文档',
      description: '这是一段描述',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard(baseKb);

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: { visibility: 'public' },
      });
    });
  });

  it('公开知识库点击切换按钮设为私有', async () => {
    const mutateAsync = vi.fn(async () => ({
      id: 'kb1',
      ownerId: 'u1',
      visibility: 'private' as const,
      name: '产品文档',
      description: '这是一段描述',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard({ ...baseKb, visibility: 'public' });

    await userEvent.click(screen.getByRole('button', { name: '设为私有' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: { visibility: 'private' },
      });
    });
  });

  it('切换可见性失败时调用 update 并提示 e.message', async () => {
    // hook-fetch 的 ResponseError 走 CJS interop 后子类原型丢失，需显式修正才能命中
    // `e instanceof ApiError` 分支（与 chat.test.tsx 一致）
    const error = new ApiError('更新失败', 500);
    Object.setPrototypeOf(error, ApiError.prototype);
    const mutateAsync = vi.fn().mockRejectedValue(error);
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard(baseKb);

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
    expect(await screen.findByText('更新失败')).toBeInTheDocument();
  });

  it('点击删除按钮弹出确认对话框', async () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

    expect(
      screen.getByText('确定要删除知识库「产品文档」吗？此操作不可恢复。'),
    ).toBeInTheDocument();
  });

  it('确认删除时调用删除接口', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
    const deleteMock = {
      ...deleteMutationMock(),
      mutateAsync: deleteMutateAsync,
    };
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard(baseKb, null, null, deleteMock);

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

    const confirmButton = screen.getByRole('button', { name: '确认删除' });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith('kb1');
    });
  });

  it('取消删除不调用接口', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
    mockedDelete.mockReturnValue({
      ...deleteMutationMock(),
      mutateAsync: deleteMutateAsync,
    });
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '删除知识库' }));

    const cancelButton = screen.getByRole('button', { name: /取\s*消/ });
    await userEvent.click(cancelButton);

    expect(deleteMutateAsync).not.toHaveBeenCalled();
  });
});
