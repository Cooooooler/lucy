import { errorMessageOf } from '@/api/client';
import type { ModelProvider } from '@/api/types.ts';
import { ModelProviderFormDrawer } from '@/components/model-provider/ModelProviderFormDrawer.tsx';
import {
  ModelProviderGrid,
  type ModelProviderPendingIds,
} from '@/components/model-provider/ModelProviderGrid.tsx';
import {
  ModelProviderToolbar,
  type ModelTypeFilter,
} from '@/components/model-provider/ModelProviderToolbar.tsx';
import { PageShell } from '@/components/page-shell';
import {
  type ModelProviderListFilter,
  useDeleteModelProvider,
  useInfiniteModelProviderList,
  useTestModelProviderConnection,
  useUpdateModelProvider,
} from '@/hooks/use-model-provider';
import { useModelProviderViewState } from '@/hooks/use-model-provider-view-state';
import { createFileRoute } from '@tanstack/react-router';
import { App } from 'antd';
import { useCallback, useMemo, useState } from 'react';

export const Route = createFileRoute('/_layout/integration/model-provider')({
  component: ModelProviderComponent,
});

/** 从「该 mutation 是否在跑 + 它的 variables」取出正在处理的模型 id */
function pendingIdOf(
  isPending: boolean,
  variables: string | { id: string } | undefined,
): string | null {
  if (!isPending || !variables) return null;
  return typeof variables === 'string' ? variables : variables.id;
}

function ModelProviderComponent() {
  const { message, modal } = App.useApp();
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useModelProviderViewState();

  // 恢复锚点只在路由本次挂载后消费一次：恢复完成后置 0（与知识库同一套逻辑）
  const [restoreIndex, setRestoreIndex] = useState(initialRestoreIndex);
  const handleRestoreDone = useCallback(() => setRestoreIndex(0), []);

  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [type, setType] = useState<ModelTypeFilter>(
    initialFilter.type ?? 'all',
  );
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  /** 单例表单抽屉的目标：create / edit(model) / 关闭(null) */
  const [formTarget, setFormTarget] = useState<
    { mode: 'create' } | { mode: 'edit'; model: ModelProvider } | null
  >(null);

  const filter = useMemo<ModelProviderListFilter>(
    () => ({
      name: committedName || undefined,
      type: type === 'all' ? undefined : type,
    }),
    [committedName, type],
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

  const pendingIds: ModelProviderPendingIds = {
    update: pendingIdOf(isUpdating, updateVariables),
    delete: pendingIdOf(isDeleting, deleteVariables),
    test: pendingIdOf(isTesting, testVariables),
  };

  const handleEdit = useCallback(
    (model: ModelProvider) => setFormTarget({ mode: 'edit', model }),
    [],
  );
  const handleCreate = useCallback(() => setFormTarget({ mode: 'create' }), []);

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

  // 改筛选后回到列表顶部，并作废恢复锚点（与知识库一致；锚点只有网格的 onRestoreDone 会消费）
  const handleSearch = useCallback(
    (value: string) => {
      setRestoreIndex(0);
      setCommittedName(value);
      saveFilter({ name: value || undefined });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  const handleTypeChange = useCallback(
    (value: ModelTypeFilter) => {
      setRestoreIndex(0);
      setType(value);
      saveFilter({ type: value === 'all' ? undefined : value });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  return (
    <>
      <ModelProviderToolbar
        type={type}
        onTypeChange={handleTypeChange}
        onSearch={handleSearch}
        defaultKeyword={initialFilter.name ?? ''}
        onCreate={handleCreate}
      />
      {/* 滚动交给 PageShell 自身：滚动条贴限宽容器右缘 */}
      <PageShell scrollable ref={setScrollElement}>
        <ModelProviderGrid
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
          hasFilter={Boolean(filter.name || filter.type)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onTest={handleTest}
          pendingIds={pendingIds}
          initialRestoreIndex={restoreIndex}
          onRestoreDone={handleRestoreDone}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
        <ModelProviderFormDrawer
          open={!!formTarget}
          mode={formTarget?.mode ?? 'create'}
          model={formTarget?.mode === 'edit' ? formTarget.model : undefined}
          onClose={() => setFormTarget(null)}
        />
      </PageShell>
    </>
  );
}
