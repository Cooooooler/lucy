import {
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { render, screen } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeList } from './KnowledgeList';
import { makeKb } from './knowledge-test-fixture';

vi.mock('@/hooks/use-knowledge', () => ({
  useUpdateKnowledgeBase: vi.fn(),
  useLikeKnowledgeBase: vi.fn(),
  useUnlikeKnowledgeBase: vi.fn(),
}));

const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);
const mockedLike = vi.mocked(useLikeKnowledgeBase);
const mockedUnlike = vi.mocked(useUnlikeKnowledgeBase);

function noopLikeMock() {
  return { mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useLikeKnowledgeBase
  > &
    ReturnType<typeof useUnlikeKnowledgeBase>;
}

describe('KnowledgeList', () => {
  it('渲染多个知识库卡片', () => {
    mockedUpdate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateKnowledgeBase>);
    mockedLike.mockReturnValue(noopLikeMock());
    mockedUnlike.mockReturnValue(noopLikeMock());
    const items = [makeKb('kb1', '知识库 A'), makeKb('kb2', '知识库 B')];
    render(
      <AntdApp>
        <KnowledgeList knowledgeBases={items} />
      </AntdApp>,
    );
    expect(screen.getByText('知识库 A')).toBeInTheDocument();
    expect(screen.getByText('知识库 B')).toBeInTheDocument();
  });

  it('空数组时不渲染任何卡片', () => {
    mockedUpdate.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateKnowledgeBase>);
    const { container } = render(
      <AntdApp>
        <KnowledgeList knowledgeBases={[]} />
      </AntdApp>,
    );
    expect(container.querySelectorAll('.ant-card')).toHaveLength(0);
  });
});
