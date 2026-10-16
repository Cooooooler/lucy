import type { ReactNode } from 'react';

export type CardShellProps = {
  /** 卡片标题：固定一行、超出省略，原生 title 提供全名查看 */
  title: string;
  /** 右上角角标（如公私状态）。存在时标题行自动留出其宽度，避免被角标盖住 */
  badge?: ReactNode;
  /** hover / 键盘聚焦时自卡片下缘滑入的操作栏内容 */
  actions?: ReactNode;
  /** 卡片主体 */
  children: ReactNode;
};

/**
 * 卡片外壳：等高约束 + hover 抬升 + 单行省略标题 + 「默认收在卡片下缘之外」的操作栏。
 *
 * 刻意**不使用 antd 的 `Card` / `Card.Meta` / `Avatar`**：实测一次挂载约 30 张卡片时，
 * antd `Card` 自身约占 140ms，而同等外观的轻量标记把总阻塞从 ~450ms 降到 ~90ms。
 * 主题仍沿用 antd 的 CSS 变量（`--ant-color-*`）。
 *
 * 不额外包 `memo`：本项目已在 vite.config.ts 启用 React Compiler，组件级重渲染由它
 * 细粒度接管，手写 `memo` 属重复优化。
 *
 * ⚠️ 高度硬约束：整卡固定 `h-52.5`（210px），与 `@/components/grid-layout` 的
 * `CARD_ESTIMATED_HEIGHT`（210）一一对应。卡片主体必须自行保持等高（标题单行省略 +
 * 描述固定高度），**改动高度必须同步改常量**，否则虚拟化行高与真实高度不一致，
 * 会导致滚动位置与恢复锚点整体偏移（固定行高下没有任何回填测量的机会去纠正）。
 */
export const CardShell = ({
  title,
  badge,
  actions,
  children,
}: CardShellProps) => {
  return (
    <div className="group relative flex h-52.5 flex-col overflow-hidden rounded-lg bg-(--ant-color-bg-container) transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-(--ant-color-split)">
      {badge}

      {/* 标题固定一行并省略。行高固定是卡片等高的前提；角标盖住标题行右侧，故留 pr-10 */}
      <div
        className={`flex h-11.5 shrink-0 items-center text-base font-semibold ${
          badge ? 'pr-10 pl-4' : 'px-4'
        }`}
        title={title}
      >
        <span className="block truncate">{title}</span>
      </div>

      {children}

      {/* 操作栏默认收在卡片下缘之外（由卡片 overflow-hidden 裁掉），hover 或键盘聚焦时才滑入。
          绝对定位不参与布局：卡片高度是虚拟化硬约束（CARD_ESTIMATED_HEIGHT），
          若让操作栏占位再隐藏，静止态会多出一条空白带。 */}
      <div className="absolute inset-x-0 bottom-0 flex h-11.5 translate-y-full items-center justify-end gap-2 border-t border-(--ant-color-split) bg-(--ant-color-bg-container) px-4 opacity-0 transition duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
        {actions}
      </div>
    </div>
  );
};
