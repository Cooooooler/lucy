import { cn } from '@/components/lib/utils';
import type { ReactNode, Ref } from 'react';

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
  /**
   * 由 PageShell 自身承担纵向滚动（按 fill 处理，占满父级高度）。
   *
   * 默认的 fill 把滚动交给页面内部的子容器，而子容器在内容盒内、被左右内边距
   * 推离容器右缘——滚动条停在内边距内侧。开启后滚动容器就是 PageShell 本身：
   * 滚动条贴在内容区右缘，内容仍按同一内边距排布。
   *
   * 该模式**不**建立纵向 flex：滚动容器的子项若会被 flex-shrink 压扁，
   * 内容就撑不开高度、也就滚不动了。子项需自带高度（如虚拟列表容器）。
   */
  scrollable?: boolean;
  className?: string;
  /** 暴露 DOM 节点：调用方据此把 PageShell 当作滚动容器（如虚拟列表的 scrollElement） */
  ref?: Ref<HTMLDivElement>;
};

/**
 * 页面内容容器：统一「居中限宽 + 分档内边距 + 高度模式」三件事。
 *
 * 宽度与内边距原本散落在各页面（`px-4 sm:px-6 md:px-8` 重复两处、`px-4 py-4 …` 一处、
 * model-provider 的 `px-6`），收敛到这里。知识库网格的虚拟列表用绝对定位、容器的 padding
 * 对其不生效，故 `grid-layout` 曾用 JS 复刻同一套断点；padding 收进容器后那份复刻即可删除。
 *
 * 限宽走 `.lucy-page-gutter`（居中内边距，见 index.css）而非 `max-width + mx-auto`：
 * 后者会把容器自身收窄到 1600px，滚动容器（scrollable）的滚动条只能停在限宽盒内缘；
 * 居中内边距让容器保持满宽，滚动条得以贴到内容区右缘，而内容盒宽度两者等价。
 */
export function PageShell({
  children,
  height = 'content',
  bleed = false,
  scrollable = false,
  className,
  ref,
}: PageShellProps) {
  return (
    <div
      ref={ref}
      className={cn(
        // scrollable 时由自身滚动：不能再叠 flex-col，否则子项被 flex-shrink 压扁
        scrollable
          ? 'h-full min-h-0 overflow-y-auto'
          : height === 'fill' && 'flex h-full min-h-0 flex-col',
        !bleed && 'lucy-page-gutter box-border w-full',
        className,
      )}
    >
      {children}
    </div>
  );
}
