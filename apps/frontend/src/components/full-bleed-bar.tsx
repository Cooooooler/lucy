import { cn } from '@/components/lib/utils';
import type { ReactNode } from 'react';

export type FullBleedBarProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
};

/**
 * 通栏工具条：底色铺满整个视口宽度，内容仍与 PageShell 的限宽容器同一左缘。
 *
 * PageShell 有 `max-w-[1600px] + mx-auto`，宽屏下两侧会留出空白。工具条若跟着限宽，
 * 底色就只覆盖中间一段（实测 2195px 视口下只有中间 1600px，两侧各空 298px）。
 *
 * 做法：**不动布局**，靠 `.lucy-full-bleed-bar::before`（见 index.css）把底色铺到 `100vw`。
 * 一旦用负 margin 或 `width: 100vw` 真去撑开元素，元素自身就变成满宽，
 * `50% - 50vw` 这类居中偏移随即归零，控件会被推到视口左缘、与下方卡片错位（实测差 298px）。
 * 伪元素不参与布局，控件位置完全不受影响。
 *
 * 已知边界：`100vw` 含页面级滚动条宽度。本仓 `#root` 是 `overflow: hidden`、长内容在内部
 * 容器滚动，没有页面级滚动条，故 `100vw` 恰等于可见宽度。若将来放开页面级滚动，
 * 需给伪元素补 `max-width: 100%` 收口。
 */
export const FullBleedBar = ({
  children,
  className,
  innerClassName,
}: FullBleedBarProps) => {
  return (
    <div className={cn('lucy-full-bleed-bar relative', className)}>
      <div
        className={cn(
          'flex items-center justify-between gap-4',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
};
