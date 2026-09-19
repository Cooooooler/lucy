import { errorMessageOf } from '@/api/client';
import type { KnowledgeBase } from '@/api/types.ts';
import { KnowledgeFormDrawer } from '@/components/knowledge/KnowledgeFormDrawer.tsx';
import {
  KnowledgeGrid,
  type KnowledgePendingIds,
} from '@/components/knowledge/KnowledgeGrid.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state.ts';
import {
  type KnowledgeListFilter,
  useDeleteKnowledgeBase,
  useInfiniteKnowledgeBaseList,
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge.ts';
import { createFileRoute } from '@tanstack/react-router';
import { App } from 'antd';
import { useCallback, useMemo, useState } from 'react';

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeComponent,
});

/** 从「该 mutation 是否在跑 + 它的 variables」取出正在处理的知识库 id */
function pendingIdOf(
  isPending: boolean,
  variables: string | { id: string } | undefined,
): string | null {
  if (!isPending || !variables) return null;
  return typeof variables === 'string' ? variables : variables.id;
}

function KnowledgeComponent() {
  const { message, modal } = App.useApp();
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useKnowledgeViewState();

  // 恢复锚点只在路由本次挂载后消费一次：恢复完成后置 0。
  // 必须由路由持有而非网格自己记账——网格仍会因加载态/空态卸载重挂
  // （首次加载、以及「改筛选后新条件无结果」等分支），网格内的「已恢复」标记会随实例归零，
  // 于是旧锚点被再次回放，把事件处理器里的 scrollTo({ top: 0 }) 覆盖掉。
  const [restoreIndex, setRestoreIndex] = useState(initialRestoreIndex);
  const handleRestoreDone = useCallback(() => setRestoreIndex(0), []);

  // 初值来自会话 store：SPA 返回时自动还原上次筛选
  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [visibility, setVisibility] = useState<VisibilityFilter>(
    initialFilter.visibility ?? 'all',
  );
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  /** 单例表单抽屉的目标：create / edit(kb) / 关闭(null) */
  const [formTarget, setFormTarget] = useState<
    { mode: 'create' } | { mode: 'edit'; kb: KnowledgeBase } | null
  >(null);

  const filter = useMemo<KnowledgeListFilter>(
    () => ({
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const query = useInfiniteKnowledgeBaseList(filter);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.list) ?? [],
    [query.data],
  );

  // 四个变更操作在路由各持有一份：卡片只上报意图。
  // 卡片数量随列表规模增长，若每张卡片各挂一套 mutation，实例与订阅数会随之线性膨胀。
  const {
    mutate: like,
    isPending: isLiking,
    variables: likeVariables,
  } = useLikeKnowledgeBase();
  const {
    mutate: unlike,
    isPending: isUnliking,
    variables: unlikeVariables,
  } = useUnlikeKnowledgeBase();
  const {
    mutateAsync: updateBase,
    isPending: isUpdating,
    variables: updateVariables,
  } = useUpdateKnowledgeBase();
  const {
    mutateAsync: deleteBase,
    isPending: isDeleting,
    variables: deleteVariables,
  } = useDeleteKnowledgeBase();

  const pendingIds: KnowledgePendingIds = {
    // 点赞与取消点赞是一对：谁在跑就是谁的 id
    like:
      pendingIdOf(isLiking, likeVariables) ??
      pendingIdOf(isUnliking, unlikeVariables),
    update: pendingIdOf(isUpdating, updateVariables),
    delete: pendingIdOf(isDeleting, deleteVariables),
  };

  // 回调用 useCallback 包裹只是让引用在「未经 React Compiler 的路径」（vitest、
  // 未启用 compiler 的 dev 配置）下也保持稳定；构建产物里 Compiler 已做细粒度 memo。
  // 不是正确性前提——卡片不再依赖 memo 包裹，回调换成新引用也不会导致重放或错渲染。
  const handleEdit = useCallback(
    (kb: KnowledgeBase) => setFormTarget({ mode: 'edit', kb }),
    [],
  );
  const handleCreate = useCallback(() => setFormTarget({ mode: 'create' }), []);

  const handleToggleLike = useCallback(
    (kb: KnowledgeBase) => {
      if (kb.isLiked) unlike(kb.id);
      else like(kb.id);
    },
    [like, unlike],
  );

  /** 可见性切换走单一字段更新（与编辑抽屉无关） */
  const handleToggleVisibility = useCallback(
    async (kb: KnowledgeBase) => {
      const next = kb.visibility === 'public' ? 'private' : 'public';
      try {
        await updateBase({ id: kb.id, input: { visibility: next } });
        message.success(next === 'public' ? '已设为公开' : '已设为私有');
      } catch (e) {
        message.error(errorMessageOf(e, '操作失败，请稍后重试'));
      }
    },
    [message, updateBase],
  );

  const handleDelete = useCallback(
    (kb: KnowledgeBase) => {
      modal.confirm({
        title: '删除知识库',
        content: `确定要删除知识库「${kb.name}」吗？此操作不可恢复。`,
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () =>
          deleteBase(kb.id).then(
            () => {
              message.success('知识库已删除');
            },
            (e) => {
              message.error(errorMessageOf(e, '删除失败，请稍后重试'));
              throw e;
            },
          ),
      });
    },
    [deleteBase, message, modal],
  );

  // 改筛选后回到列表顶部：直接写进改变筛选的两个用户事件里，不再用 filterKey 派生值 + effect。
  // 筛选只可能由这两个事件改变，用 effect 比对「上一次 key」是对同一动作的重复建模，
  // 还多一趟 effect 与一个纯记账 ref。放进事件处理器天然满足「挂载时不归零」
  // （挂载不触发这两个处理器），因此不会与首可见项恢复互相打架。
  //
  // 同时必须**作废恢复锚点**：锚点只有网格的 onRestoreDone 会消费，而网格在骨架
  // （冷加载）与空态（新条件无结果）下根本不挂载 KnowledgeGridVirtual，恢复 effect
  // 不跑、也就永远不会回调。此时若把旧锚点留在路由上，等新条件的数据回来、网格重新
  // 挂载时会拿它去恢复旧位置，把这里的 scrollTo({ top: 0 }) 覆盖掉。
  const handleSearch = useCallback(
    (value: string) => {
      setRestoreIndex(0);
      setCommittedName(value);
      saveFilter({ name: value || undefined });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  const handleVisibilityChange = useCallback(
    (value: VisibilityFilter) => {
      setRestoreIndex(0);
      setVisibility(value);
      saveFilter({ visibility: value === 'all' ? undefined : value });
      scrollElement?.scrollTo({ top: 0 });
    },
    [saveFilter, scrollElement],
  );

  return (
    <div className="flex h-full flex-col">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        onSearch={handleSearch}
        defaultKeyword={initialFilter.name ?? ''}
        onCreate={handleCreate}
      />
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto">
        <KnowledgeGrid
          scrollElement={scrollElement}
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          isPlaceholderData={query.isPlaceholderData}
          fetchNextPage={query.fetchNextPage}
          refetch={query.refetch}
          hasFilter={Boolean(filter.name || filter.visibility)}
          onEdit={handleEdit}
          onToggleLike={handleToggleLike}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDelete}
          pendingIds={pendingIds}
          initialRestoreIndex={restoreIndex}
          onRestoreDone={handleRestoreDone}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
      </div>
      <KnowledgeFormDrawer
        open={!!formTarget}
        mode={formTarget?.mode ?? 'create'}
        kb={formTarget?.mode === 'edit' ? formTarget.kb : undefined}
        onClose={() => setFormTarget(null)}
      />
    </div>
  );
}
