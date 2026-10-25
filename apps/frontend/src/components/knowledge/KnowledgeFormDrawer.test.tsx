import {
  useCreateKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { useModelProvidersByType } from '@/hooks/use-model-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// 重排模型下拉走模型列表 hook：默认空列表（= 不使用重排），需要时在用例里覆盖
vi.mock('@/hooks/use-model-provider', () => ({
  useModelProvidersByType: vi.fn(() => ({ models: [], isLoading: false })),
}));

/**
 * 本地 message.success 的调用 spy：抽屉不再自己弹成功提示（改由后端 message
 * 经全局桥弹出），把 useApp 的 message 换成可观测对象即能断言「未调用」。
 */
const messageSuccess = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const mod = await importOriginal<typeof import('antd')>();
  const useApp = () => {
    const real = mod.App.useApp();
    return { ...real, message: { ...real.message, success: messageSuccess } };
  };
  return { ...mod, App: { ...mod.App, useApp } };
});

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
 * 模拟 hook-fetch 克隆后的请求错误：**类身份丢失**（`instanceof ApiError` 为 false，
 * 见 api/client.ts 的 errorMessageOf 说明），只剩 message/name/code/status 字段。
 * 用它而非 `new ApiError()`，是为了让「必须按字段取值」这条约束在测试里可证伪。
 */
function clonedApiError(message: string, code: number, status: number): Error {
  return Object.assign(new Error(message), { name: 'ApiError', code, status });
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
    // 逐例复位：重排模型默认空列表（mock 实现不会被 clearAllMocks 清掉）
    vi.mocked(useModelProvidersByType).mockReturnValue({
      models: [],
      isLoading: false,
    });
  });

  it('创建态提交调用 createKnowledgeBaseApi 并关闭抽屉；成功提示由全局桥弹出（抽屉不再自己弹）', async () => {
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
        // 检索设置只在创建时提交：未改动即落默认值
        retrievalMode: 'fulltext',
        topK: 5,
        scoreThresholdEnabled: false,
        scoreThreshold: 0,
        semanticWeight: 50,
        rerankModelId: null,
      });
    });
    expect(screen.queryByText('知识库创建成功')).not.toBeInTheDocument();
    // 可失败的「不再自己弹」：本地 message.success 一旦被调用即失败
    expect(messageSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(updateMock.mutateAsync).not.toHaveBeenCalled();
    expect(createMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('创建态未填描述时校验失败，不提交也不关闭', async () => {
    const createMock = setCreateMock(mutationMock());
    const { onClose } = renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '仅名称');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(screen.getByText('请输入知识库描述')).toBeInTheDocument();
    });
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
    await userEvent.type(screen.getByLabelText('描述'), '公开资料');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        name: '公开库',
        description: '公开资料',
        visibility: 'public',
        retrievalMode: 'fulltext',
        topK: 5,
        scoreThresholdEnabled: false,
        scoreThreshold: 0,
        semanticWeight: 50,
        rerankModelId: null,
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
    // 编辑态只读且该知识库没有重排模型：不白拉 rerank 模型列表
    expect(useModelProvidersByType).toHaveBeenCalledWith('rerank', false);

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
    expect(screen.queryByText('知识库更新成功')).not.toBeInTheDocument();
    // 可失败的「不再自己弹」：本地 message.success 一旦被调用即失败
    expect(messageSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
    expect(updateMock.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('编辑态清空描述时校验失败，不提交', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setUpdateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'edit', kb: baseKb });

    await userEvent.clear(screen.getByLabelText('描述'));
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(screen.getByText('请输入知识库描述')).toBeInTheDocument();
    });
    expect(mutateAsync).not.toHaveBeenCalled();
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
      .mockRejectedValue(clonedApiError('名称已存在', 409, 409));
    setCreateMock(mutationMock({ mutateAsync }));
    const { onClose } = renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '重复名称');
    await userEvent.type(screen.getByLabelText('描述'), '描述');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('名称已存在')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('编辑态接口抛 ApiError 时提示 e.message 且不关闭抽屉', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(clonedApiError('无权修改', 403, 403));
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
    await userEvent.type(screen.getByLabelText('描述'), '描述');
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

  it('检索设置：Score 开关在标签右侧并控制拖动条，混合检索展示互补权重', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setCreateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'create' });

    // 检索设置只在创建态出现
    expect(screen.getByText('检索设置')).toBeInTheDocument();
    // 召回条数同样是「数值输入 + 拖动条」
    const topK = screen.getByRole('spinbutton', { name: '召回条数（TopK）' });
    expect(topK).toHaveValue('5');
    expect(
      screen.getByRole('slider', { name: '召回条数（TopK）' }),
    ).toBeVisible();
    // 直接改数值（InputNumber 受控，逐字符输入会被清空回落值打断）
    fireEvent.change(topK, { target: { value: '8' } });
    expect(
      screen.getByRole('slider', { name: '召回条数（TopK）' }),
    ).toHaveAttribute('aria-valuenow', '8');

    // 开关挂在「Score 阈值」标签内；关闭时数值输入与拖动条一起隐藏（display:none 不进可访问树）
    expect(screen.getByText('Score 阈值')).toBeInTheDocument();
    expect(
      screen.queryByRole('slider', { name: 'Score 阈值' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('spinbutton', { name: /Score 阈值/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('switch', { name: '启用 Score 阈值' }),
    );

    // 拖动条前方有数值输入：回显当前值，也可直接输入修改
    // （label 里还有开关的 aria-label，故用正则匹配）
    const threshold = screen.getByRole('spinbutton', { name: /Score 阈值/ });
    expect(threshold).toHaveValue('0.00');
    expect(screen.getByRole('slider', { name: 'Score 阈值' })).toBeVisible();
    fireEvent.change(threshold, { target: { value: '0.35' } });
    expect(threshold).toHaveValue('0.35');
    // 拖动条与输入框同步：值落到 slider 的 aria-valuenow
    expect(screen.getByRole('slider', { name: 'Score 阈值' })).toHaveAttribute(
      'aria-valuenow',
      '0.35',
    );

    // 非混合检索不出现权重；切到混合后权重默认 50/50
    expect(
      screen.queryByRole('spinbutton', { name: /语义权重/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('混合检索'));
    expect(
      await screen.findByRole('spinbutton', { name: /语义权重/ }),
    ).toHaveValue('50');
    expect(
      screen.getByRole('slider', { name: '关键词权重（%）' }),
    ).toHaveAttribute('aria-valuenow', '50');

    // 关键词权重是派生值：改成 30 会反算语义权重为 70（两个滑块此消彼长）
    const keyword = screen.getByRole('spinbutton', { name: /关键词权重/ });
    await userEvent.clear(keyword);
    await userEvent.type(keyword, '30');
    expect(screen.getByRole('spinbutton', { name: /语义权重/ })).toHaveValue(
      '70',
    );
    expect(
      screen.getByRole('slider', { name: '语义权重（%）' }),
    ).toHaveAttribute('aria-valuenow', '70');
    expect(
      screen.getByRole('slider', { name: '关键词权重（%）' }),
    ).toHaveAttribute('aria-valuenow', '30');

    await userEvent.type(screen.getByLabelText('名称'), '混合库');
    await userEvent.type(screen.getByLabelText('描述'), '混合检索描述');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          retrievalMode: 'hybrid',
          topK: 8,
          scoreThresholdEnabled: true,
          scoreThreshold: 0.35,
          semanticWeight: 70,
          // 重排开关未开启，即使下拉里没有选择也提交 null
          rerankModelId: null,
        }),
      );
    });
  });

  it('启用 Score 阈值却为 0 时校验失败，不提交', async () => {
    const createMock = setCreateMock(mutationMock());
    renderDrawer({ mode: 'create' });

    await userEvent.type(screen.getByLabelText('名称'), '阈值库');
    await userEvent.type(screen.getByLabelText('描述'), '阈值描述');
    await userEvent.click(
      screen.getByRole('switch', { name: '启用 Score 阈值' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    expect(await screen.findByText('启用阈值时需大于 0')).toBeInTheDocument();
    expect(createMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('检索设置：重排模型由开关控制，开启后选择并提交模型 ID', async () => {
    vi.mocked(useModelProvidersByType).mockReturnValue({
      models: [{ id: 'r1', name: 'bge-reranker' }],
      isLoading: false,
    } as never);
    const mutateAsync = vi.fn().mockResolvedValue({});
    setCreateMock(mutationMock({ mutateAsync }));
    renderDrawer({ mode: 'create' });

    // 开关关闭且没有引用时不请求 rerank 列表
    expect(useModelProvidersByType).toHaveBeenLastCalledWith('rerank', false);

    // 开关关闭时模型下拉不进入可访问树
    expect(
      screen.queryByRole('combobox', { name: /重排模型/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: '启用重排模型' }));
    // 打开开关后才启用该查询
    expect(useModelProvidersByType).toHaveBeenLastCalledWith('rerank', true);

    const select = screen.getByRole('combobox', { name: /重排模型/ });
    expect(select).toBeVisible();
    await userEvent.click(select);
    await userEvent.click(await screen.findByText('bge-reranker'));

    await userEvent.type(screen.getByLabelText('名称'), '重排库');
    await userEvent.type(screen.getByLabelText('描述'), '重排描述');
    await userEvent.click(screen.getByRole('button', { name: /创\s*建/ }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ rerankModelId: 'r1' }),
      );
    });
  });

  it('表单分为基础设置与检索设置两块，检索说明收在标题后的问号 Tooltip 里', async () => {
    renderDrawer({ mode: 'create' });

    expect(screen.getByText('基础设置')).toBeInTheDocument();
    expect(screen.getByText('检索设置')).toBeInTheDocument();
    // 默认不展示说明文案，悬停问号图标才出现
    expect(screen.queryByText('创建后不可修改')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByLabelText('检索设置说明'));
    expect(await screen.findByText('创建后不可修改')).toBeInTheDocument();
  });

  it('编辑态可见检索设置但全部只读（创建后不可修改）', () => {
    vi.mocked(useModelProvidersByType).mockReturnValue({
      models: [{ id: 'r1', name: 'bge-reranker' }],
      isLoading: false,
    } as never);
    renderDrawer({
      mode: 'edit',
      kb: {
        ...baseKb,
        retrievalMode: 'hybrid',
        topK: 8,
        scoreThresholdEnabled: true,
        scoreThreshold: 0.35,
        semanticWeight: 70,
        rerankModelId: 'r1',
      },
    });

    expect(screen.getByText('检索设置')).toBeInTheDocument();

    // 检索模式回显且禁用（antd Segmented 的禁用态挂在容器上）
    const hybrid = screen.getByRole('radio', { name: '混合检索' });
    expect(hybrid).toBeChecked();
    expect(hybrid.closest('.ant-segmented')).toHaveClass(
      'ant-segmented-disabled',
    );

    // 重排：开关开、模型名回显，开关与下拉都禁用
    expect(screen.getByRole('switch', { name: '启用重排模型' })).toBeChecked();
    expect(screen.getByRole('switch', { name: '启用重排模型' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /重排模型/ })).toBeDisabled();
    expect(screen.getByText('bge-reranker')).toBeInTheDocument();

    // 召回条数回显并禁用
    const topK = screen.getByRole('spinbutton', { name: '召回条数（TopK）' });
    expect(topK).toHaveValue('8');
    expect(topK).toBeDisabled();

    // Score：开关开、阈值回显并禁用
    expect(
      screen.getByRole('switch', { name: '启用 Score 阈值' }),
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: '启用 Score 阈值' }),
    ).toBeDisabled();
    const threshold = screen.getByRole('spinbutton', { name: /Score 阈值/ });
    expect(threshold).toHaveValue('0.35');
    expect(threshold).toBeDisabled();

    // 混合权重回显并禁用（关键词 = 100 - 语义）；两个滑块读数相反
    const semantic = screen.getByRole('spinbutton', { name: /语义权重/ });
    expect(semantic).toHaveValue('70');
    expect(semantic).toBeDisabled();
    const keyword = screen.getByRole('spinbutton', { name: /关键词权重/ });
    expect(keyword).toHaveValue('30');
    expect(keyword).toBeDisabled();
    expect(
      screen.getByRole('slider', { name: '语义权重（%）' }),
    ).toHaveAttribute('aria-valuenow', '70');
    expect(
      screen.getByRole('slider', { name: '关键词权重（%）' }),
    ).toHaveAttribute('aria-valuenow', '30');
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
