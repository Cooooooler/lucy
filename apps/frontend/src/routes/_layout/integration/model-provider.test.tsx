import type { ModelProvider } from '@/api/types.ts';
import { ModelProviderGrid } from '@/components/model-provider/ModelProviderGrid.tsx';
import { makeModel } from '@/components/model-provider/model-provider-test-fixture.ts';
import { useInfiniteModelProviderList } from '@/hooks/use-model-provider';
import { useModelProviderViewState } from '@/hooks/use-model-provider-view-state';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
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
  };
});

vi.mock('@/hooks/use-model-provider', () => ({
  useInfiniteModelProviderList: vi.fn(),
  useCreateModelProvider: vi.fn(() => mutationMocks.create),
  useUpdateModelProvider: vi.fn(() => mutationMocks.update),
  useDeleteModelProvider: vi.fn(() => mutationMocks.delete),
  useTestModelProviderConnection: vi.fn(() => mutationMocks.test),
}));

vi.mock('@/components/model-provider/ModelProviderGrid.tsx', () => ({
  ModelProviderGrid: vi.fn(() => null),
}));

vi.mock('@/hooks/use-model-provider-view-state', () => ({
  useModelProviderViewState: vi.fn(),
}));

const mockedList = vi.mocked(useInfiniteModelProviderList);
const mockedGrid = vi.mocked(ModelProviderGrid);
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

function mockViewState(
  initialFilter: { name?: string; type?: ModelProvider['type'] } = {},
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

function gridHandler(name: string) {
  return lastGridProps()[name] as (model: ModelProvider) => unknown;
}

describe('routes/_layout/integration/model-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockReturnValue(noopQuery());
    mockedGrid.mockReturnValue(null);
    for (const mutation of Object.values(mutationMocks)) {
      mutation.isPending = false;
      mutation.variables = undefined;
      mutation.mutateAsync.mockResolvedValue(undefined);
    }
    mockViewState();
  });

  it('用 store 中冻结的筛选与恢复索引初始化', () => {
    const { saveFirstVisibleIndex } = mockViewState(
      { name: 'gpt', type: 'llm' },
      7,
    );

    renderRoute();

    expect(mockedList).toHaveBeenLastCalledWith({ name: 'gpt', type: 'llm' });
    expect(screen.getByPlaceholderText('按名称搜索模型')).toHaveValue('gpt');
    expect(lastGridProps()).toMatchObject({
      initialRestoreIndex: 7,
      onFirstVisibleItemChange: saveFirstVisibleIndex,
      hasFilter: true,
    });
  });

  it('点击「新增模型」打开单例表单抽屉', async () => {
    renderRoute();
    await userEvent.click(screen.getByText('新增模型'));
    expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  });

  it('网格 onEdit 打开编辑抽屉并预填', async () => {
    renderRoute();
    act(() => gridHandler('onEdit')(makeModel('m9', '架构模型')));
    expect(await screen.findByDisplayValue('架构模型')).toBeInTheDocument();
  });

  it('删除：确认后调用接口；成功提示由全局桥弹出', async () => {
    renderRoute();
    await act(async () => {
      gridHandler('onDelete')(makeModel('m1', '模型甲'));
    });
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
    renderRoute();
    await act(async () => {
      await gridHandler('onTest')(makeModel('m1', '模型甲'));
    });
    expect(mutationMocks.test.mutateAsync).toHaveBeenCalledWith('m1');
    expect(messageSuccess).toHaveBeenCalledWith('连接成功（12ms）');
  });

  it('测试连接失败：按结果文案弹错误提示', async () => {
    mutationMocks.test.mutateAsync.mockResolvedValueOnce({
      ok: false,
      message: 'API Key 无效或无权限',
      latencyMs: null,
      detail: null,
    });
    renderRoute();
    await act(async () => {
      await gridHandler('onTest')(makeModel('m1', '模型甲'));
    });
    expect(messageError).toHaveBeenCalledWith('API Key 无效或无权限');
  });

  it('测试连接异常：走兜底文案', async () => {
    mutationMocks.test.mutateAsync.mockRejectedValueOnce(
      new Error('Failed to fetch'),
    );
    renderRoute();
    await act(async () => {
      await gridHandler('onTest')(makeModel('m1', '模型甲'));
    });
    expect(messageError).toHaveBeenCalledWith('测试失败，请稍后重试');
  });

  it('改变筛选写回 store 并作废恢复锚点', async () => {
    const { saveFilter } = mockViewState({}, 5);
    renderRoute();

    await userEvent.click(screen.getByText('文本嵌入'));
    expect(saveFilter).toHaveBeenCalledWith({ type: 'text-embedding' });
    expect(lastGridProps().initialRestoreIndex).toBe(0);

    const input = screen.getByPlaceholderText('按名称搜索模型');
    await userEvent.type(input, 'gpt{Enter}');
    expect(saveFilter).toHaveBeenCalledWith({ name: 'gpt' });
  });

  it('把 mutation 的 pending 态整理成 pendingIds 传给网格', () => {
    mutationMocks.update.isPending = true;
    mutationMocks.update.variables = { id: 'm5', input: { name: 'x' } };
    mutationMocks.delete.isPending = true;
    mutationMocks.delete.variables = 'm6';
    mutationMocks.test.isPending = true;
    mutationMocks.test.variables = 'm7';

    renderRoute();

    expect(lastGridProps().pendingIds).toEqual({
      update: 'm5',
      delete: 'm6',
      test: 'm7',
    });
  });
});
