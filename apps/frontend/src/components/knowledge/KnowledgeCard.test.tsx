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
) {
  mockedLike.mockReturnValue(likeMock ?? noopMutationMock());
  mockedUnlike.mockReturnValue(unlikeMock ?? noopMutationMock());
  mockedDelete.mockReturnValue(deleteMock ?? deleteMutationMock());
  return render(
    <AntdApp>
      <KnowledgeCard kb={kb} />
    </AntdApp>,
  );
}

describe('KnowledgeCard', () => {
  it('渲染知识库名称', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByText('产品文档')).toBeInTheDocument();
  });

  it('渲染描述文本', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByText('这是一段描述')).toBeInTheDocument();
  });

  it('渲染点赞按钮', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByRole('button', { name: '点赞' })).toBeInTheDocument();
  });

  it('点击编辑按钮打开编辑抽屉并预填数据', async () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));

    expect(screen.getByLabelText('名称')).toHaveValue('产品文档');
    expect(screen.getByLabelText('描述')).toHaveValue('这是一段描述');
  });

  it('提交编辑表单调用 updateKnowledgeBaseApi', async () => {
    const mutateAsync = vi.fn(async () => ({
      id: 'kb1',
      ownerId: 'u1',
      visibility: 'private' as const,
      name: '新名称',
      description: '这是一段描述',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));
    await userEvent.clear(screen.getByLabelText('名称'));
    await userEvent.type(screen.getByLabelText('名称'), '新名称');

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: {
          name: '新名称',
          description: '这是一段描述',
          visibility: 'private',
        },
      });
    });
  });

  it('清空描述提交时发送空字符串', async () => {
    const mutateAsync = vi.fn(async () => ({
      id: 'kb1',
      ownerId: 'u1',
      visibility: 'private' as const,
      name: '产品文档',
      description: '',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }));
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));
    await userEvent.clear(screen.getByLabelText('描述'));

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: {
          name: '产品文档',
          description: '',
          visibility: 'private',
        },
      });
    });
  });

  it('纯空格名称不提交', async () => {
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
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: '编辑知识库' }));
    await userEvent.clear(screen.getByLabelText('名称'));
    await userEvent.type(screen.getByLabelText('名称'), '   ');

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(mutateAsync).not.toHaveBeenCalled();
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

  it('切换可见性失败时提示错误', async () => {
    const error = new ApiError('更新失败', 500);
    const mutateAsync = vi.fn().mockRejectedValue(error);
    mockedUpdate.mockReturnValue(updateMutationMock({ mutateAsync }));
    renderCard(baseKb);

    await userEvent.click(screen.getByRole('button', { name: '设为公开' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
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
