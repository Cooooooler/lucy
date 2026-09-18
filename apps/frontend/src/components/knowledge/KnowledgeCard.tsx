import { ApiError } from '@/api/client';
import type { KnowledgeBase } from '@/api/types.ts';
import {
  DeleteOutlined,
  EditOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@/components/knowledge/knowledge-icons.tsx';
import {
  useDeleteKnowledgeBase,
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { App } from 'antd';

type KnowledgeCardProps = {
  kb: KnowledgeBase;
  /** 点击「编辑」时上报意图；表单抽屉由路由持有（卡片不再自持抽屉） */
  onEdit?: (kb: KnowledgeBase) => void;
};

/**
 * 知识库卡片。
 *
 * 刻意**不使用 antd 的 `Card` / `Card.Meta` / `Avatar` / `Button`**：实测返回知识库时
 * 单次挂载约 30 张卡片，antd `Card` 自身约占 140ms、4 个 antd `Button` 约占 80ms
 * （LoAF 实测，dev/StrictMode 下），而同等外观的轻量标记把总阻塞从 ~450ms 降到 ~90ms。
 * 主题仍沿用 antd 的 CSS 变量（`--ant-color-*`），与 `KnowledgeToolbar` 的做法一致。
 *
 * 不额外包 `memo`：本项目已在 vite.config.ts 启用 React Compiler，组件级重渲染由它
 * 细粒度接管，手写 `memo` 属重复优化，且会把「回调必须引用稳定」变成一条并不存在的正确性前提。
 *
 * ⚠️ 高度硬约束：整卡固定 `h-[210px]`，与 `grid-layout.ts` 的 `CARD_ESTIMATED_HEIGHT`（210）
 * 一一对应。改动高度必须同步改常量，否则虚拟化行高与真实高度不一致会导致滚动位置整体偏移。
 */
export function KnowledgeCard({ kb, onEdit }: KnowledgeCardProps) {
  const { message, modal } = App.useApp();
  const updateMutation = useUpdateKnowledgeBase();
  const likeMutation = useLikeKnowledgeBase();
  const unlikeMutation = useUnlikeKnowledgeBase();
  const deleteMutation = useDeleteKnowledgeBase();

  const handleToggleLike = () => {
    if (kb.isLiked) {
      unlikeMutation.mutate(kb.id);
    } else {
      likeMutation.mutate(kb.id);
    }
  };

  const handleDelete = () => {
    modal.confirm({
      title: '删除知识库',
      content: `确定要删除知识库「${kb.name}」吗？此操作不可恢复。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () =>
        deleteMutation.mutateAsync(kb.id).then(
          () => {
            message.success('知识库已删除');
          },
          (e) => {
            if (e instanceof ApiError) {
              message.error(e.message);
            } else {
              message.error('删除失败，请稍后重试');
            }
            throw e;
          },
        ),
    });
  };

  /** 可见性切换仍走单一字段更新（与编辑抽屉无关，保留在卡片内） */
  const handleToggleVisibility = async () => {
    const newVisibility = kb.visibility === 'public' ? 'private' : 'public';
    try {
      await updateMutation.mutateAsync({
        id: kb.id,
        input: { visibility: newVisibility },
      });
      message.success(newVisibility === 'public' ? '已设为公开' : '已设为私有');
    } catch (e) {
      if (e instanceof ApiError) {
        message.error(e.message);
      } else {
        message.error('操作失败，请稍后重试');
      }
    }
  };

  return (
    <div className="flex h-[210px] flex-col overflow-hidden rounded-lg bg-(--ant-color-bg-container) transition-shadow hover:shadow-md">
      {/* 标题固定一行并省略；原生 title 提供全名查看。行高固定是卡片等高的前提 */}
      <div
        className="flex h-[46px] shrink-0 items-center px-4 text-base font-semibold"
        title={kb.name}
      >
        <span className="block truncate">{kb.name}</span>
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-4 px-4 py-3">
        <img
          src="https://api.dicebear.com/10.x/lorelei/svg?seed=1"
          alt=""
          className="h-8 w-8 shrink-0 rounded-full"
        />
        <div
          className="line-clamp-2 h-11 text-sm text-gray-500"
          title={kb.description ?? undefined}
        >
          {kb.description}
        </div>
      </div>

      <div className="flex h-[46px] shrink-0 items-stretch divide-x divide-(--ant-color-split) border-t border-(--ant-color-split)">
        <button
          type="button"
          title={kb.isLiked ? '取消点赞' : '点赞'}
          aria-label={kb.isLiked ? '取消点赞' : '点赞'}
          disabled={likeMutation.isPending || unlikeMutation.isPending}
          onClick={handleToggleLike}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1 text-gray-400 transition-colors hover:text-[#ff6b6b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {kb.isLiked ? (
            <HeartFilled style={{ color: '#ff6b6b' }} />
          ) : (
            <HeartOutlined style={{ color: '#ff6b6b' }} />
          )}
          {(kb.likeCount ?? 0) > 0 ? (
            <span className="text-xs">{kb.likeCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          title={kb.visibility === 'public' ? '设为私有' : '设为公开'}
          aria-label={kb.visibility === 'public' ? '设为私有' : '设为公开'}
          disabled={updateMutation.isPending}
          onClick={handleToggleVisibility}
          className="flex flex-1 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#4ecdc4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {kb.visibility === 'public' ? (
            <UnlockOutlined style={{ color: '#4ecdc4' }} />
          ) : (
            <LockOutlined style={{ color: '#4ecdc4' }} />
          )}
        </button>
        <button
          type="button"
          title="编辑知识库"
          aria-label="编辑知识库"
          onClick={() => onEdit?.(kb)}
          className="flex flex-1 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#45b7d1]"
        >
          <EditOutlined style={{ color: '#45b7d1' }} />
        </button>
        <button
          type="button"
          title="删除知识库"
          aria-label="删除知识库"
          disabled={deleteMutation.isPending}
          onClick={handleDelete}
          className="flex flex-1 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#ff6b6b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DeleteOutlined style={{ color: '#ff6b6b' }} />
        </button>
      </div>
    </div>
  );
}
