import { errorMessageOf } from '@/api/client';
import type { KnowledgeBase } from '@/api/types.ts';
import {
  VirtualCardGrid,
  type CardGridEmptyLabel,
} from '@/components/card-list/VirtualCardGrid.tsx';
import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard.tsx';
import { KnowledgeFormDrawer } from '@/components/knowledge/KnowledgeFormDrawer.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { PageShell } from '@/components/page-shell';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state.ts';
import {
  useDeleteKnowledgeBase,
  useInfiniteKnowledgeBaseList,
  useLikeKnowledgeBase,
  useRefreshKnowledgeBaseList,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
  type KnowledgeListFilter,
} from '@/hooks/use-knowledge.ts';
import {
  pendingIdOf,
  useListPageChrome,
} from '@/hooks/use-list-page-chrome.ts';
import { createFileRoute, Link } from '@tanstack/react-router';
import { App } from 'antd';
import { useCallback, useMemo, useState } from 'react';

/** 正在 pending 的变更操作所对应的知识库 id（null 表示当前没有） */
type KnowledgePendingIds = {
  like: string | null;
  update: string | null;
  delete: string | null;
};

const EMPTY_LABEL: CardGridEmptyLabel = {
  filtered: '没有匹配的知识库',
  initial: '暂无知识库',
};

const KnowledgeComponent = () => {
  const { message, modal } = App.useApp();
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useKnowledgeViewState();

  // 恢复锚点、滚动容器、以及「回顶 + 作废锚点 + 写回 store」三件套都由公共件持有
  const {
    restoreIndex,
    consumeRestore,
    scrollElement,
    setScrollElement,
    resetToTop,
    onFilterChange,
  } = useListPageChrome<KnowledgeListFilter>({
    initialRestoreIndex,
    saveFilter,
  });

  // 初值来自会话 store：SPA 返回时自动还原上次筛选
  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [visibility, setVisibility] = useState<VisibilityFilter>(
    initialFilter.visibility ?? 'all',
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
  const refreshList = useRefreshKnowledgeBaseList();

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

  // 三个 mutation 的 pending 态拼成「谁在 pending」：用 useMemo 兜住引用，
  // 否则下面 renderItem 的依赖每轮都变，等于给网格传一个新 renderItem。
  const pendingIds = useMemo<KnowledgePendingIds>(
    () => ({
      // 点赞与取消点赞是一对：谁在跑就是谁的 id
      like:
        pendingIdOf(isLiking, likeVariables) ??
        pendingIdOf(isUnliking, unlikeVariables),
      update: pendingIdOf(isUpdating, updateVariables),
      delete: pendingIdOf(isDeleting, deleteVariables),
    }),
    [
      deleteVariables,
      isDeleting,
      isLiking,
      isUnliking,
      isUpdating,
      likeVariables,
      unlikeVariables,
      updateVariables,
    ],
  );

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
        // 成功提示（「已设为公开/私有」）由后端 message 经全局桥弹出
        await updateBase({ id: kb.id, input: { visibility: next } });
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
            // 成功提示（「知识库已删除」）由后端 message 经全局桥弹出
            undefined,
            (e) => {
              message.error(errorMessageOf(e, '删除失败，请稍后重试'));
              throw e;
            },
          ),
      });
    },
    [deleteBase, message, modal],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setCommittedName(value);
      onFilterChange({ name: value || undefined });
    },
    [onFilterChange],
  );

  const handleVisibilityChange = useCallback(
    (value: VisibilityFilter) => {
      setVisibility(value);
      onFilterChange({ visibility: value === 'all' ? undefined : value });
    },
    [onFilterChange],
  );

  /** 刷新：丢弃所有筛选的列表缓存并让当前筛选从第一页重新加载 */
  const handleRefresh = useCallback(() => {
    resetToTop();
    void refreshList();
  }, [refreshList, resetToTop]);

  // 卡片只接收该条目自己的 pending 标记；回调用 useCallback 包裹让引用在
  // 「未经 React Compiler 的路径」（vitest、未启用 compiler 的 dev 配置）下也保持稳定
  const renderItem = useCallback(
    (kb: KnowledgeBase) => (
      <KnowledgeCard
        kb={kb}
        /* 打开详情的热区由路由注入：真锚点（中键/⌘+点击可新标签页打开、可 Tab 聚焦），
           卡片本身不认识路由，与「mutation 提升到路由」同一分工 */
        openLink={
          <Link
            to="/knowledge/$kbId"
            params={{ kbId: kb.id }}
            aria-label={`打开知识库：${kb.name}`}
            title={kb.name}
            className="absolute inset-0"
          />
        }
        onEdit={handleEdit}
        onToggleLike={handleToggleLike}
        onToggleVisibility={handleToggleVisibility}
        onDelete={handleDelete}
        isLikePending={pendingIds.like === kb.id}
        isUpdatePending={pendingIds.update === kb.id}
        isDeletePending={pendingIds.delete === kb.id}
      />
    ),
    [
      handleDelete,
      handleEdit,
      handleToggleLike,
      handleToggleVisibility,
      pendingIds,
    ],
  );

  return (
    <>
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        onSearch={handleSearch}
        onRefresh={handleRefresh}
        defaultKeyword={initialFilter.name ?? ''}
        onCreate={handleCreate}
      />
      {/* 滚动交给 PageShell 自身：滚动条贴限宽容器右缘，而不是被内边距推离 */}
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
          hasFilter={Boolean(filter.name || filter.visibility)}
          emptyLabel={EMPTY_LABEL}
          renderItem={renderItem}
          initialRestoreIndex={restoreIndex}
          onRestoreDone={consumeRestore}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
        <KnowledgeFormDrawer
          open={!!formTarget}
          mode={formTarget?.mode ?? 'create'}
          kb={formTarget?.mode === 'edit' ? formTarget.kb : undefined}
          onClose={() => setFormTarget(null)}
        />
      </PageShell>
    </>
  );
};

export const Route = createFileRoute('/_layout/knowledge/')({
  component: KnowledgeComponent,
});
