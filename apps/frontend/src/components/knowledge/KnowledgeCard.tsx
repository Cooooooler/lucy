import type { KnowledgeBase } from '@/api/types.ts';
import { CardShell } from '@/components/card-list/CardShell.tsx';
import {
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
} from '@/components/icons.tsx';

type KnowledgeCardProps = {
  kb: KnowledgeBase;
  /** 各操作只上报意图：mutation 与提示由路由统一持有（见路由的 pendingIds） */
  onEdit?: (kb: KnowledgeBase) => void;
  onToggleLike: (kb: KnowledgeBase) => void;
  onToggleVisibility: (kb: KnowledgeBase) => void;
  onDelete: (kb: KnowledgeBase) => void;
  /** 该卡片对应的操作是否正在进行（同一时刻只可能有一个知识库在 pending） */
  isLikePending: boolean;
  isUpdatePending: boolean;
  isDeletePending: boolean;
};

/**
 * 知识库卡片：外壳（等高约束 / hover 抬升 / 单行省略标题 / 滑入操作栏）由
 * `@/components/card-list/CardShell` 统一承担，这里只填角标、主体与操作按钮。
 *
 * 刻意**不自持 mutation**：卡片数量随列表规模增长，每张卡片各挂一套
 * `useLikeKnowledgeBase`/`useUnlikeKnowledgeBase`/`useUpdateKnowledgeBase`/`useDeleteKnowledgeBase`
 * 会让订阅与实例数量随条目数线性膨胀。四个 mutation 已提升到路由，卡片只收回调与 pending 标记。
 */
export const KnowledgeCard = ({
  kb,
  onEdit,
  onToggleLike,
  onToggleVisibility,
  onDelete,
  isLikePending,
  isUpdatePending,
  isDeletePending,
}: KnowledgeCardProps) => {
  const isPublic = kb.visibility === 'public';

  return (
    <CardShell
      title={kb.name}
      /* 公私状态：右上角三角角标（`clip-path` 沿对角线切出，实色 + 白色图标）。
         形状（地球 / 锁）与配色（青 / 灰）双重区分——只靠 lock/unlock 的锁梁开口，
         在 14px 白字下几乎看不出差别。角标盖住标题行右侧，故标题行留出 pr-10（见 CardShell） */
      badge={
        <button
          type="button"
          title={isPublic ? '设为私有' : '设为公开'}
          aria-label={isPublic ? '设为私有' : '设为公开'}
          disabled={isUpdatePending}
          onClick={() => onToggleVisibility(kb)}
          className={`absolute top-0 right-0 flex size-11 cursor-pointer items-start justify-end p-1.5 text-white transition-colors [clip-path:polygon(0_0,100%_0,100%_100%)] disabled:cursor-not-allowed disabled:opacity-50 ${
            isPublic
              ? 'bg-[#4ecdc4] hover:bg-[#45b8b0]'
              : 'bg-[#8c8c8c] hover:bg-[#7a7a7a]'
          }`}
        >
          {isPublic ? <GlobalOutlined /> : <LockOutlined />}
        </button>
      }
      actions={
        <>
          <button
            type="button"
            title={kb.isLiked ? '取消点赞' : '点赞'}
            aria-label={kb.isLiked ? '取消点赞' : '点赞'}
            disabled={isLikePending}
            onClick={() => onToggleLike(kb)}
            className="flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1 text-gray-400 transition-colors hover:text-[#ff6b6b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {kb.isLiked ? (
              <HeartFilled style={{ color: '#ff6b6b' }} />
            ) : (
              <HeartOutlined style={{ color: '#ff6b6b' }} />
            )}
            {kb.likeCount > 0 ? (
              <span className="text-xs">{kb.likeCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            title="编辑知识库"
            aria-label="编辑知识库"
            onClick={() => onEdit?.(kb)}
            className="flex h-8 min-w-8 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#45b7d1]"
          >
            <EditOutlined style={{ color: '#45b7d1' }} />
          </button>
          <button
            type="button"
            title="删除知识库"
            aria-label="删除知识库"
            disabled={isDeletePending}
            onClick={() => onDelete(kb)}
            className="flex h-8 min-w-8 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#ff6b6b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DeleteOutlined style={{ color: '#ff6b6b' }} />
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 items-start gap-4 px-4 py-3">
        {/* 装饰性头像：显式宽高避免加载时占位抖动，lazy/async 让它不参与首屏关键路径。
            注意它仍是第三方资源（api.dicebear.com）——是否改为仓库内联/本地 SVG 见后续决定。 */}
        <img
          src="https://api.dicebear.com/10.x/lorelei/svg?seed=1"
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          className="h-8 w-8 shrink-0 rounded-full"
        />
        <div
          className="line-clamp-2 h-11 text-sm text-gray-500"
          title={kb.description || undefined}
        >
          {kb.description}
        </div>
      </div>
    </CardShell>
  );
};
