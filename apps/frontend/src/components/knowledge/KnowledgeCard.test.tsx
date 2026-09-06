import { useUpdateKnowledgeBase } from '@/hooks/use-knowledge';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeCard } from './KnowledgeCard';
import { baseKb } from './knowledge-test-fixture';

vi.mock('@/hooks/use-knowledge', () => ({
  useUpdateKnowledgeBase: vi.fn(),
}));

const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);

function updateMutationMock(
  overrides: Partial<ReturnType<typeof useUpdateKnowledgeBase>> = {},
) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useUpdateKnowledgeBase>;
}

function renderCard(kb = baseKb) {
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

  it('渲染详情按钮', () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();
    expect(screen.getByText('详情')).toBeInTheDocument();
  });

  it('点击编辑图标打开编辑抽屉并预填数据', async () => {
    mockedUpdate.mockReturnValue(updateMutationMock());
    renderCard();

    await userEvent.click(screen.getByRole('img', { name: 'edit' }));

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

    await userEvent.click(screen.getByRole('img', { name: 'edit' }));
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
});
