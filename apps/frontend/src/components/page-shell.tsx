import { cn } from '@/components/lib/utils';
import type { ReactNode } from 'react';

/** 高度模式：fill = 占满剩余高度并在内部滚动；content = 按内容自然高度 */
export type PageShellHeight = 'fill' | 'content';

export type PageShellProps = {
  children: ReactNode;
  /**
   * 高度模式，默认 content。
   * - fill：占满父级剩余高度，页面内部自建滚动容器（列表/分栏类页面）
   * - content：按内容自然高度，溢出由页面容器自身处理（文章/表单类页面）
   */
  height?: PageShellHeight;
  /**
   * 豁免宽度与内边距：贴边布局用（如 chat 的 antd Splitter —— 面板宽度按百分比分配、
   * 折叠拖拽定位到视口边缘，任何横向内边距都会让三栏错位）。
   * 仍会应用高度模式。
   */
  bleed?: boolean;
  className?: string;
};

/**
 * 页面内容容器：统一「居中限宽 + 分档内边距 + 高度模式」三件事。
 *
 * 宽度与内边距原本散落在各页面（`px-4 sm:px-6 md:px-8` 重复两处、`px-4 py-4 …` 一处、
 * model-provider 的 `px-6`），收敛到这里。知识库网格的虚拟列表用绝对定位、容器的 padding
 * 对其不生效，故 `grid-layout` 曾用 JS 复刻同一套断点；padding 收进容器后那份复刻即可删除。
 */
export function PageShell({
  children,
  height = 'content',
  bleed = false,
  className,
}: PageShellProps) {
  return (
    <div
      className={cn(
        height === 'fill' && 'flex h-full min-h-0 flex-col',
        !bleed &&
          'mx-auto box-border w-full max-w-[1600px] px-4 sm:px-6 md:px-8',
        className,
      )}
    >
      {children}
    </div>
  );
}
