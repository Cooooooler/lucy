import {
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
}));

const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);
const mockedLike = vi.mocked(useLikeKnowledgeBase);
const mockedUnlike = vi.mocked(useUnlikeKnowledgeBase);

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
  } as unknown as ReturnType<typeof useLikeKnowledgeBase> &
    ReturnType<typeof useUnlikeKnowledgeBase>;
}

function renderCard(kb = baseKb) {
  mockedLike.mockReturnValue(noopMutationMock());
  mockedUnlike.mockReturnValue(noopMutationMock());
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
});
