import type { ModelProvider } from '@/api/types.ts';
import { VirtualCardGrid } from '@/components/card-list/VirtualCardGrid.tsx';
import { makeModel } from '@/components/model-provider/model-provider-test-fixture.ts';
import {
  useInfiniteModelProviderList,
  useModelProviderDefaults,
  useModelProvidersByType,
} from '@/hooks/use-model-provider';
import { useModelProviderViewState } from '@/hooks/use-model-provider-view-state';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { FC, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as ModelProviderRoute } from './model-provider';

/** 本地 message spy：成功提示由后端 message 经全局桥弹出，路由只在「测试连接」时自行提示 */
const messageSuccess = vi.fn();
const messageError = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const mod = await importOriginal<typeof import('antd')>();
  const useApp = () => {
    const real = mod.App.useApp();
    return {
      ...real,
      message: {
        ...real.message,
        success: messageSuccess,
        error: messageError,
      },
    };
  };
  return { ...mod, App: { ...mod.App, useApp } };
});

const mutationMocks = vi.hoisted(() => {
  const makeMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    variables: undefined as unknown,
  });
  return {
    create: makeMutation(),
    update: makeMutation(),
    delete: makeMutation(),
    test: makeMutation(),
    updateDefaults: makeMutation(),
  };
});

vi.mock('@/hooks/use-model-provider', () => ({
  useInfiniteModelProviderList: vi.fn(),
  useCreateModelProvider: vi.fn(() => mutationMocks.create),
  useUpdateModelProvider: vi.fn(() => mutationMocks.update),
  useDeleteModelProvider: vi.fn(() => mutationMocks.delete),
  useTestModelProviderConnection: vi.fn(() => mutationMocks.test),
  useModelProviderDefaults: vi.fn(),
  useModelProvidersByType: vi.fn(),
  useUpdateModelProviderDefaults: vi.fn(() => mutationMocks.updateDefaults),
}));

/**
 * 通用网格的桩：把每条数据都经路由的 `renderItem` 真实渲染出来（不虚拟化）。
 * 这样既保留了「路由往下传了什么」的断言（`mockedGrid.mock.calls`），
 * 又能通过真实卡片上的按钮驱动路由的事件处理器。
 */
type GridStubProps = {
  items: ModelProvider[];
  renderItem: (item: ModelProvider) => ReactNode;
};

vi.mock('@/components/card-list/VirtualCardGrid.tsx', async () => {
  const { createElement, Fragment } = await import('react');
  return {
    VirtualCardGrid: vi.fn((props: GridStubProps) =>
      createElement(
        Fragment,
        null,
        props.items.map((item) =>
          createElement(Fragment, { key: item.id }, props.renderItem(item)),
        ),
      ),
    ),
  };
});

vi.mock('@/hooks/use-model-provider-view-state', () => ({
  useModelProviderViewState: vi.fn(),
}));

const mockedList = vi.mocked(useInfiniteModelProviderList);
const mockedDefaults = vi.mocked(useModelProviderDefaults);
const mockedModelsByType = vi.mocked(useModelProvidersByType);
const mockedGrid = vi.mocked(VirtualCardGrid);
const mockedViewState = vi.mocked(useModelProviderViewState);

function noopQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    isPlaceholderData: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteModelProviderList>;
}

/** 让列表返回指定条目（页面据渲染成真实卡片） */
function mockItems(items: ModelProvider[]) {
  mockedList.mockReturnValue({
    ...noopQuery(),
    data: { pages: [{ list: items, nextCursor: null }], pageParams: [null] },
  } as unknown as ReturnType<typeof useInfiniteModelProviderList>);
}

function mockViewState(
  initialFilter: { name?: string; vendor?: ModelProvider['vendor'] } = {},
  initialRestoreIndex = 0,
) {
  const saveFilter = vi.fn();
  const saveFirstVisibleIndex = vi.fn();
  mockedViewState.mockReturnValue({
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  });
  return { saveFilter, saveFirstVisibleIndex };
}

function renderRoute() {
  const C = ModelProviderRoute.options.component as FC;
  return render(
    <AntdApp>
      <C />
    </AntdApp>,
  );
}

function lastGridProps() {
  return mockedGrid.mock.calls.at(-1)?.[0] as unknown as Record<
    string,
    unknown
  >;
}

describe('routes/_layout/integration/model-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockReturnValue(noopQuery());
    for (const mutation of Object.values(mutationMocks)) {
      mutation.isPending = false;
      mutation.variables = undefined;
      mutation.mutateAsync.mockResolvedValue(undefined);
    }
    mockViewState();
    mockedDefaults.mockReturnValue({
      data: { defaults: [] },
      isLoading: false,
      isSuccess: true,
    } as unknown as ReturnType<typeof useModelProviderDefaults>);
    mockedModelsByType.mockReturnValue({ models: [], isLoading: false });
  });

  it('用 store 中冻结的筛选与恢复索引初始化', () => {
    const { saveFirstVisibleIndex } = mockViewState(
      { name: 'gpt', vendor: 'openai' },
      7,
    );

    renderRoute();

    expect(mockedList).toHaveBeenLastCalledWith({
      name: 'gpt',
      vendor: 'openai',
    });
    expect(screen.getByPlaceholderText('按名称搜索模型')).toHaveValue('gpt');
    expect(lastGridProps()).toMatchObject({
      initialRestoreIndex: 7,
      onFirstVisibleItemChange: saveFirstVisibleIndex,
      hasFilter: true,
      emptyLabel: { filtered: '没有匹配的模型', initial: '暂无模型' },
    });
  });

  it('点击「新增模型」打开单例表单抽屉', async () => {
    renderRoute();
    await userEvent.click(screen.getByText('新增模型'));
    expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  });

  it('点击「默认模型设置」打开弹窗，保存时提交全部模型类型', async () => {
    renderRoute();
    await userEvent.click(screen.getByText('默认模型设置'));
    expect(await screen.findByText('文本嵌入')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() =>
      expect(mutationMocks.updateDefaults.mutateAsync).toHaveBeenCalledTimes(1),
    );
    const payload = mutationMocks.updateDefaults.mutateAsync.mock
      .calls[0][0] as {
      defaults: Array<{ type: string; modelProviderId: string | null }>;
    };
    expect(payload.defaults.map((item) => item.type)).toEqual([
      'llm',
      'text-embedding',
      'rerank',
      'speech2text',
      'tts',
      'moderation',
    ]);
    expect(
      payload.defaults.every((item) => item.modelProviderId === null),
    ).toBe(true);
  });

  it('卡片的编辑意图打开编辑抽屉并预填', async () => {
    mockItems([makeModel('m9', '架构模型')]);
    renderRoute();
    await userEvent.click(screen.getByRole('button', { name: '编辑模型' }));
    expect(await screen.findByDisplayValue('架构模型')).toBeInTheDocument();
  });

  it('删除：确认后调用接口；成功提示由全局桥弹出', async () => {
    mockItems([makeModel('m1', '模型甲')]);
    renderRoute();
    await userEvent.click(screen.getByRole('button', { name: '删除模型' }));
    expect(
      screen.getByText('确定要删除模型「模型甲」吗？此操作不可恢复。'),
    ).toBeInTheDocument();
    expect(mutationMocks.delete.mutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() =>
      expect(mutationMocks.delete.mutateAsync).toHaveBeenCalledWith('m1'),
    );
    expect(messageSuccess).not.toHaveBeenCalled();
  });

  it('测试连接成功：按 ok 弹成功提示（含耗时）', async () => {
    mutationMocks.test.mutateAsync.mockResolvedValueOnce({
      ok: true,
      message: '连接成功',
      latencyMs: 12,
      detail: null,
    });
    mockItems([makeModel('m1', '模型甲')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() =>
      expect(mutationMocks.test.mutateAsync).toHaveBeenCalledWith('m1'),
    );
    expect(messageSuccess).toHaveBeenCalledWith('连接成功（12ms）');
  });

  it('测试连接失败：按结果文案弹错误提示', async () => {
    mutationMocks.test.mutateAsync.mockResolvedValueOnce({
      ok: false,
      message: 'API Key 无效或无权限',
      latencyMs: null,
      detail: null,
    });
    mockItems([makeModel('m1', '模型甲')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith('API Key 无效或无权限'),
    );
  });

  it('测试连接异常：走兜底文案', async () => {
    mutationMocks.test.mutateAsync.mockRejectedValueOnce(
      new Error('Failed to fetch'),
    );
    mockItems([makeModel('m1', '模型甲')]);
    renderRoute();

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await waitFor(() =>
      expect(messageError).toHaveBeenCalledWith('测试失败，请稍后重试'),
    );
  });

  it('改变筛选写回 store 并作废恢复锚点', async () => {
    const { saveFilter } = mockViewState({}, 5);
    renderRoute();

    await userEvent.click(screen.getByText('OpenAI'));
    expect(saveFilter).toHaveBeenCalledWith({ vendor: 'openai' });
    expect(lastGridProps().initialRestoreIndex).toBe(0);

    const input = screen.getByPlaceholderText('按名称搜索模型');
    await userEvent.type(input, 'gpt{Enter}');
    expect(saveFilter).toHaveBeenCalledWith({ name: 'gpt' });
  });

  it('把 mutation 的 pending 态落到对应卡片的禁用态', () => {
    mutationMocks.update.isPending = true;
    mutationMocks.update.variables = { id: 'm5', input: { name: 'x' } };
    mutationMocks.delete.isPending = true;
    mutationMocks.delete.variables = 'm5';
    mutationMocks.test.isPending = true;
    mutationMocks.test.variables = 'm5';
    mockItems([makeModel('m5', '模型甲')]);

    renderRoute();

    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑模型' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除模型' })).toBeDisabled();
  });

  it('pending 指向别的模型时当前卡片保持可用', () => {
    mutationMocks.test.isPending = true;
    mutationMocks.test.variables = 'm9';
    mockItems([makeModel('m1', '模型甲')]);

    renderRoute();

    expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled();
  });
});
