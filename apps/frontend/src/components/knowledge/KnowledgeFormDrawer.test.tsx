import { ApiError } from '@/api/client';
import {
  useCreateKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { KnowledgeFormDrawer } from './KnowledgeFormDrawer';
import { baseKb } from './knowledge-test-fixture';

vi.mock('@/hooks/use-knowledge', () => ({
  useCreateKnowledgeBase: vi.fn(),
  useUpdateKnowledgeBase: vi.fn(),
}));

const mockedCreate = vi.mocked(useCreateKnowledgeBase);
const mockedUpdate = vi.mocked(useUpdateKnowledgeBase);

type MutationMock = { mutateAsync: Mock; isPending: boolean };

function mutationMock(overrides: Partial<MutationMock> = {}): MutationMock {
  return { mutateAsync: vi.fn(), isPending: false, ...overrides };
}

/** 设置创建态 mutation 的返回值并返回该 mock，便于断言未被调用 */
function setCreateMock(mock: MutationMock) {
  mockedCreate.mockReturnValue(
    mock as unknown as ReturnType<typeof useCreateKnowledgeBase>,
  );
  return mock;
}

/** 设置编辑态 mutation 的返回值并返回该 mock，便于断言未被调用 */
function setUpdateMock(mock: MutationMock) {
  mockedUpdate.mockReturnValue(
    mock as unknown as ReturnType<typeof useUpdateKnowledgeBase>,
  );
  return mock;
}

type DrawerProps = ComponentProps<typeof KnowledgeFormDrawer>;

/**
 * hook-fetch 的 ResponseError 走 CJS interop 后，`new ApiError()` 的实例原型链
 * 停在 ResponseError.prototype 上（子类原型丢失，`instanceof ApiError` 为 false）。
 * 这里与 chat.test.tsx 一致，显式修正原型链，才能命中 `e instanceof ApiError` 分支。
 */
function apiError(message: string, code: number, status: number): ApiError {
  const error = new ApiError(message, code, status);
  Object.setPrototypeOf(error, ApiError.prototype);
  return error;
}

/** 渲染单例抽屉（默认创建态、已打开），onClose 由工厂注入 */
function renderDrawer(props: Partial<Omit<DrawerProps, 'onClose'>> = {}) {
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <AntdApp>
        <KnowledgeFormDrawer open mode="create" onClose={onClose} {...props} />
      </AntdApp>,
    ),
  };
}

describe('KnowledgeFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    setCreateMock(mutationMock());
    setUpdateMock(mutationMock());
  });

  it('创建态提交调用 createKnowledgeBaseApi，提示成功并关闭抽屉', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const createMock = setCreateMock(mutationMock({ mutateAsync }));
    const updateMock = setUpdateMock(mutationMock());
    const { onClose } = renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '产品文档');
    await userEvent.type(screen.getByLabelText('描述'), '团队产品资料');

    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '产品文档',
        description: '团队产品资料',
        visibility: 'private',
      });
    });
    expect(await screen.findByText('知识库创建成功')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updateMock.mutateAsync).not.toHaveBeenCalled();
    expect(createMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('创建态未填描述时提交 undefined（可见性默认 private）', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setCreateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '仅名称');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '仅名称',
        description: undefined,
        visibility: 'private',
      });
    });
  });

  it('创建态可见性只有私有/公开两项，切换为公开后随表单提交', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setCreateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'create' });

    expect(screen.getByText('私有')).toBeInTheDocument();
    expect(screen.getByText('公开')).toBeInTheDocument();
    expect(screen.queryByText('全部')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('公开'));
    await userEvent.type(screen.getByLabelText('名称'), '公开库');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '公开库',
        description: undefined,
        visibility: 'public',
      });
    });
  });

  it('名称为空时校验失败，不提交也不关闭', async () => {
    const createMock = setCreateMock(mutationMock());
    const { onClose } = renderDrawer({ mode: 'create' });

    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(
        document.querySelector('.ant-form-item-explain-error'),
      ).toBeInTheDocument();
    });
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('名称仅空格时校验失败，不提交', async () => {
    const createMock = setCreateMock(mutationMock());
    renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '   ');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(
        document.querySelector('.ant-form-item-explain-error'),
      ).toBeInTheDocument();
    });
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('编辑态预填当前知识库，提交时以 { id, input } 调用 updateKnowledgeBaseApi', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    const updateMock = setUpdateMock(mutationMock({ mutateAsync }));
    const createMock = setCreateMock(mutationMock());
    const { onClose } = renderDrawer({ mode: 'edit', kb: baseKb });

    expect(screen.getByLabelText('名称')).toHaveValue('产品文档');
    expect(screen.getByLabelText('描述')).toHaveValue('这是一段描述');

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
    expect(await screen.findByText('知识库更新成功')).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
    expect(updateMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('编辑态清空描述时提交空串（后端以空串表示清空，省略字段表示不修改）', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setUpdateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'edit', kb: baseKb });

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

  it('编辑态预填可见性并随表单提交', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setUpdateMock(mutationMock({ mutateAsync }));
    renderDrawer({
      mode: 'edit',
      kb: { ...baseKb, visibility: 'public' },
    });

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'kb1',
        input: {
          name: '产品文档',
          description: '这是一段描述',
          visibility: 'public',
        },
      });
    });
  });

  it('创建态接口抛 ApiError 时提示 e.message 且不关闭抽屉', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(apiError('名称已存在', 409, 409));
    setCreateMock(mutationMock({ mutateAsync }));
    const { onClose } = renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '重复名称');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('名称已存在')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('编辑态接口抛 ApiError 时提示 e.message 且不关闭抽屉', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(apiError('无权修改', 403, 403));
    setUpdateMock(mutationMock({ mutateAsync }));
    const { onClose } = renderDrawer({ mode: 'edit', kb: baseKb });

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('无权修改')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('创建态接口抛非 ApiError 时提示通用失败文案', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network error'));
    setCreateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '测试');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('创建失败，请稍后重试')).toBeInTheDocument();
  });

  it('编辑态接口抛非 ApiError 时提示通用更新失败文案', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network error'));
    setUpdateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'edit', kb: baseKb });

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('更新失败，请稍后重试')).toBeInTheDocument();
  });

  it('按 mode 渲染标题与主按钮文案', () => {
    const { unmount } = renderDrawer({ mode: 'create' });
    expect(screen.getByText('新增知识库')).toBeInTheDocument();
    unmount();

    renderDrawer({ mode: 'edit', kb: baseKb });
    expect(screen.getByText('编辑知识库')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保\s*存/ })).toBeInTheDocument();
  });
});
