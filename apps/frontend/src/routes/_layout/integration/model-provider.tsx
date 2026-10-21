import { errorMessageOf } from '@/api/client';
import type { ModelProvider } from '@/api/types.ts';
import {
  VirtualCardGrid,
  type CardGridEmptyLabel,
} from '@/components/card-list/VirtualCardGrid.tsx';
import { DefaultModelSettingsModal } from '@/components/model-provider/DefaultModelSettingsModal.tsx';
import { ModelProviderCard } from '@/components/model-provider/ModelProviderCard.tsx';
import { ModelProviderFormDrawer } from '@/components/model-provider/ModelProviderFormDrawer.tsx';
import {
  ModelProviderToolbar,
  type ModelVendorFilter,
} from '@/components/model-provider/ModelProviderToolbar.tsx';
import { PageShell } from '@/components/page-shell';
import { pendingIdOf, useListPageChrome } from '@/hooks/use-list-page-chrome';
import {
  useDeleteModelProvider,
  useInfiniteModelProviderList,
  useTestModelProviderConnection,
  useUpdateModelProvider,
  type ModelProviderListFilter,
} from '@/hooks/use-model-provider';
import { useModelProviderViewState } from '@/hooks/use-model-provider-view-state';
import { createFileRoute } from '@tanstack/react-router';
import { App } from 'antd';
import { useCallback, useMemo, useState } from 'react';

/** 正在 pending 的变更操作所对应的模型 id（null 表示当前没有） */
type ModelProviderPendingIds = {
  update: string | null;
  delete: string | null;
  test: string | null;
};

const EMPTY_LABEL: CardGridEmptyLabel = {
  filtered: '没有匹配的模型',
  initial: '暂无模型',
};

const ModelProviderComponent = () => {
  const { message, modal } = App.useApp();
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useModelProviderViewState();

  // 恢复锚点、滚动容器、以及「回顶 + 作废锚点 + 写回 store」三件套都由公共件持有（与知识库同一套）
  const {
    restoreIndex,
    consumeRestore,
    scrollElement,
    setScrollElement,
    onFilterChange,
  } = useListPageChrome<ModelProviderListFilter>({
    initialRestoreIndex,
    saveFilter,
  });

  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [vendor, setVendor] = useState<ModelVendorFilter>(
    initialFilter.vendor ?? 'all',
  );
  /** 单例表单抽屉的目标：create / edit(model) / 关闭(null) */
  const [formTarget, setFormTarget] = useState<
    { mode: 'create' } | { mode: 'edit'; model: ModelProvider } | null
  >(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  const filter = useMemo<ModelProviderListFilter>(
    () => ({
      name: committedName || undefined,
      vendor: vendor === 'all' ? undefined : vendor,
    }),
    [committedName, vendor],
  );

  const query = useInfiniteModelProviderList(filter);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.list) ?? [],
    [query.data],
  );

  // 变更操作在路由各持有一份：卡片只上报意图（避免每张卡片各挂一套 mutation）
  // 编辑提交在表单抽屉内完成，路由只需 pending 态用于禁用卡片按钮
  const { isPending: isUpdating, variables: updateVariables } =
    useUpdateModelProvider();
  const {
    mutateAsync: deleteModel,
    isPending: isDeleting,
    variables: deleteVariables,
  } = useDeleteModelProvider();
  const {
    mutateAsync: testConnection,
    isPending: isTesting,
    variables: testVariables,
  } = useTestModelProviderConnection();

  // 三个 mutation 的 pending 态拼成「谁在 pending」：用 useMemo 兜住引用，
  // 否则下面 renderItem 的依赖每轮都变，等于给网格传一个新 renderItem。
  const pendingIds = useMemo<ModelProviderPendingIds>(
    () => ({
      update: pendingIdOf(isUpdating, updateVariables),
      delete: pendingIdOf(isDeleting, deleteVariables),
      test: pendingIdOf(isTesting, testVariables),
    }),
    [
      deleteVariables,
      isDeleting,
      isTesting,
      isUpdating,
      testVariables,
      updateVariables,
    ],
  );

  const handleEdit = useCallback(
    (model: ModelProvider) => setFormTarget({ mode: 'edit', model }),
    [],
  );
  const handleCreate = useCallback(() => setFormTarget({ mode: 'create' }), []);
  const handleOpenDefaults = useCallback(() => setDefaultsOpen(true), []);
  const handleCloseDefaults = useCallback(() => setDefaultsOpen(false), []);

  const handleTest = useCallback(
    async (model: ModelProvider) => {
      try {
        const result = await testConnection(model.id);
        if (result.ok) {
          const latency =
            result.latencyMs == null ? '' : `（${result.latencyMs}ms）`;
          message.success(`${result.message}${latency}`);
        } else {
          message.error(result.message);
        }
      } catch (e) {
        message.error(errorMessageOf(e, '测试失败，请稍后重试'));
      }
    },
    [message, testConnection],
  );

  const handleDelete = useCallback(
    (model: ModelProvider) => {
      modal.confirm({
        title: '删除模型',
        content: `确定要删除模型「${model.name}」吗？此操作不可恢复。`,
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () =>
          deleteModel(model.id).then(
            // 成功提示（「模型已删除」）由后端 message 经全局桥弹出
            undefined,
            (e) => {
              message.error(errorMessageOf(e, '删除失败，请稍后重试'));
              throw e;
            },
          ),
      });
    },
    [deleteModel, message, modal],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setCommittedName(value);
      onFilterChange({ name: value || undefined });
    },
    [onFilterChange],
  );

  const handleVendorChange = useCallback(
    (value: ModelVendorFilter) => {
      setVendor(value);
      onFilterChange({ vendor: value === 'all' ? undefined : value });
    },
    [onFilterChange],
  );

  // 卡片只接收该条目自己的 pending 标记；回调用 useCallback 包裹让引用在
  // 「未经 React Compiler 的路径」（vitest、未启用 compiler 的 dev 配置）下也保持稳定
  const renderItem = useCallback(
    (model: ModelProvider) => (
      <ModelProviderCard
        model={model}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onTest={handleTest}
        isUpdatePending={pendingIds.update === model.id}
        isDeletePending={pendingIds.delete === model.id}
        isTestPending={pendingIds.test === model.id}
      />
    ),
    [handleDelete, handleEdit, handleTest, pendingIds],
  );

  return (
    <>
      <ModelProviderToolbar
        vendor={vendor}
        onVendorChange={handleVendorChange}
        onSearch={handleSearch}
        defaultKeyword={initialFilter.name ?? ''}
        onCreate={handleCreate}
        onOpenDefaults={handleOpenDefaults}
      />
      {/* 滚动交给 PageShell 自身：滚动条贴限宽容器右缘 */}
      <PageShell scrollable ref={setScrollElement}>
        <VirtualCardGrid
          scrollElement={scrollElement}
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          isPlaceholderData={query.isPlaceholderData}
          fetchNextPage={query.fetchNextPage}
          refetch={query.refetch}
          hasFilter={Boolean(filter.name || filter.vendor)}
          emptyLabel={EMPTY_LABEL}
          renderItem={renderItem}
          initialRestoreIndex={restoreIndex}
          onRestoreDone={consumeRestore}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
        <ModelProviderFormDrawer
          open={!!formTarget}
          mode={formTarget?.mode ?? 'create'}
          model={formTarget?.mode === 'edit' ? formTarget.model : undefined}
          onClose={() => setFormTarget(null)}
        />
        <DefaultModelSettingsModal
          open={defaultsOpen}
          onClose={handleCloseDefaults}
        />
      </PageShell>
    </>
  );
};

export const Route = createFileRoute('/_layout/integration/model-provider')({
  component: ModelProviderComponent,
});
