import { ApiError } from '@/api/client';
import { useCreateKnowledgeBase } from '@/hooks/use-knowledge';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeToolbar, VISIBILITY_OPTIONS } from './KnowledgeToolbar';

vi.mock('@/hooks/use-knowledge', () => ({
  useCreateKnowledgeBase: vi.fn(),
}));

const mockedCreate = vi.mocked(useCreateKnowledgeBase);

function createMutationMock(
  overrides: Partial<ReturnType<typeof useCreateKnowledgeBase>> = {},
) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useCreateKnowledgeBase>;
}

/** 渲染 KnowledgeToolbar 的工厂函数，包裹 AntdApp 以承载 message 上下文 */
function renderToolbar(
  props: Partial<{
    visibility: 'all' | 'private' | 'public';
    onVisibilityChange: () => void;
    onSearch: (value: string) => void;
  }> = {},
) {
  return render(
    <AntdApp>
      <KnowledgeToolbar
        visibility={props.visibility ?? 'all'}
        onVisibilityChange={props.onVisibilityChange ?? (() => {})}
        onSearch={props.onSearch ?? (() => {})}
      />
    </AntdApp>,
  );
}

describe('KnowledgeToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清理 antd message 残留
    document.body.innerHTML = '';
  });

  it('渲染三个可见性选项', () => {
    mockedCreate.mockReturnValue(createMutationMock());
    renderToolbar();
    for (const opt of VISIBILITY_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
  });

  it('点击可见性选项触发回调', async () => {
    mockedCreate.mockReturnValue(createMutationMock());
    const onVisibilityChange = vi.fn();
    renderToolbar({ onVisibilityChange });
    await userEvent.click(screen.getByText('公开'));
    expect(onVisibilityChange).toHaveBeenCalledWith('public');
  });

  it('私有选项初始选中时渲染正确', () => {
    mockedCreate.mockReturnValue(createMutationMock());
    renderToolbar({ visibility: 'private' });
    expect(screen.getByText('私有')).toBeInTheDocument();
  });

  it('搜索触发 onSearch 并 trim', async () => {
    mockedCreate.mockReturnValue(createMutationMock());
    const onSearch = vi.fn();
    renderToolbar({ onSearch });
    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.type(input, '  测试  ');
    const buttons = screen.getAllByRole('button');
    const searchButton = buttons.find((b) =>
      b.querySelector('[aria-label="search"]'),
    )!;
    await userEvent.click(searchButton);
    expect(onSearch).toHaveBeenCalledWith('测试');
  });

  it('点击"新增知识库"打开抽屉', async () => {
    mockedCreate.mockReturnValue(createMutationMock());
    renderToolbar();
    await userEvent.click(screen.getByText('新增知识库'));
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('描述')).toBeInTheDocument();
    expect(screen.getByText('可见性')).toBeInTheDocument();
  });

  it('提交表单调用 createKnowledgeBaseApi 并提示成功', async () => {
    const mutateAsync = vi.fn(async () => ({
      id: 'kb-new',
      ownerId: 'u1',
      visibility: 'private' as const,
      name: '产品文档',
      description: '团队产品资料',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }));
    mockedCreate.mockReturnValue(createMutationMock({ mutateAsync }));
    renderToolbar();

    await userEvent.click(screen.getByText('新增知识库'));
    await userEvent.type(screen.getByLabelText('名称'), '产品文档');
    await userEvent.type(screen.getByLabelText('描述'), '团队产品资料');

    const createButton = screen.getByRole('button', { name: /创\s*建/ });
    await userEvent.click(createButton);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '产品文档',
        description: '团队产品资料',
        visibility: 'private',
      });
    });
  });

  it('名称必填校验', async () => {
    mockedCreate.mockReturnValue(createMutationMock());
    renderToolbar();

    await userEvent.click(screen.getByText('新增知识库'));
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(
        document.querySelector('.ant-form-item-explain-error'),
      ).toBeInTheDocument();
    });
  });

  it('创建失败时调用 mutateAsync 并传入正确参数', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new ApiError('名称已存在', 409, 409));
    mockedCreate.mockReturnValue(createMutationMock({ mutateAsync }));
    renderToolbar();

    await userEvent.click(screen.getByText('新增知识库'));
    await userEvent.type(screen.getByLabelText('名称'), '重复名称');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '重复名称',
        description: undefined,
        visibility: 'private',
      });
    });
  });
});
