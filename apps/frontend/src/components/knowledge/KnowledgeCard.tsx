import type { KnowledgeBase } from '@/api/types.ts';
import {
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
} from '@/components/knowledge/knowledge-icons.tsx';

type KnowledgeCardProps = {
  kb: KnowledgeBase;
  /** 各操作只上报意图：mutation 与提示由路由统一持有（见 KnowledgeGrid 的 pendingIds） */
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
 * 知识库卡片（纯展示）。
 *
 * 刻意**不使用 antd 的 `Card` / `Card.Meta` / `Avatar` / `Button`**：实测返回知识库时
 * 单次挂载约 30 张卡片，antd `Card` 自身约占 140ms、4 个 antd `Button` 约占 80ms
 * （LoAF 实测，dev/StrictMode 下），而同等外观的轻量标记把总阻塞从 ~450ms 降到 ~90ms。
 * 主题仍沿用 antd 的 CSS 变量（`--ant-color-*`），与 `KnowledgeToolbar` 的做法一致。
 *
 * 同样刻意**不自持 mutation**：卡片数量随列表规模增长，每张卡片各挂一套
 * `useLikeKnowledgeBase`/`useUnlikeKnowledgeBase`/`useUpdateKnowledgeBase`/`useDeleteKnowledgeBase`
 * 会让订阅与实例数量随条目数线性膨胀。四个 mutation 已提升到路由，卡片只收回调与 pending 标记。
 *
 * 不额外包 `memo`：本项目已在 vite.config.ts 启用 React Compiler，组件级重渲染由它
 * 细粒度接管，手写 `memo` 属重复优化，且会把「回调必须引用稳定」变成一条并不存在的正确性前提。
 *
 * ⚠️ 高度硬约束：整卡固定 `h-[210px]`，与 `grid-layout.ts` 的 `CARD_ESTIMATED_HEIGHT`（210）
 * 一一对应。改动高度必须同步改常量，否则虚拟化行高与真实高度不一致会导致滚动位置整体偏移。
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
    <div className="group relative flex h-52.5 flex-col overflow-hidden rounded-lg bg-(--ant-color-bg-container) transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-(--ant-color-split)">
      {/* 公私状态：右上角三角角标（`clip-path` 沿对角线切出，实色 + 白色图标）。
          形状（地球 / 锁）与配色（青 / 灰）双重区分——只靠 lock/unlock 的锁梁开口，
          在 14px 白字下几乎看不出差别。角标盖住标题行右侧，故标题行留 `pr-10`。 */}
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

      {/* 标题固定一行并省略；原生 title 提供全名查看。行高固定是卡片等高的前提 */}
      <div
        className="flex h-11.5 shrink-0 items-center pr-10 pl-4 text-base font-semibold"
        title={kb.name}
      >
        <span className="block truncate">{kb.name}</span>
      </div>

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
          title={kb.description ?? undefined}
        >
          {kb.description}
        </div>
      </div>

      {/* 操作栏默认收在卡片下缘之外（由卡片 overflow-hidden 裁掉），hover 或键盘聚焦时才滑入。
          绝对定位不参与布局：卡片高度是虚拟化硬约束（CARD_ESTIMATED_HEIGHT），
          若让操作栏占位再隐藏，静止态会多出一条空白带。 */}
      <div className="absolute inset-x-0 bottom-0 flex h-11.5 translate-y-full items-center justify-end gap-2 border-t border-(--ant-color-split) bg-(--ant-color-bg-container) px-4 opacity-0 transition duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
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
      </div>
    </div>
  );
};
