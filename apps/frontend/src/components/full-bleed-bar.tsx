import { cn } from '@/components/lib/utils';
import type { ReactNode } from 'react';

export type FullBleedBarProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /**
   * 是否再用 `100vw` 伪元素把底色铺到视口两侧（默认 true）。
   *
   * 只在工具条**窄于内容区**时才需要：放在 PageShell 内时，盒子被 `.lucy-page-gutter`
   * 的居中内边距包住（宽屏下内容盒只有 1600px），自身底色够不到视口两端，得靠伪元素补。
   *
   * 直接挂在页面容器层级（与 PageShell 平级）时盒子已占满内容区，应传 false：此时伪元素
   * 反倒出错——`left: 50%` 是相对工具条**自身盒子**居中的，而带副菜单（sider）的页面里
   * 这个盒子整体右移了一个 sider 宽，`100vw` 的底色于是左边溢进副菜单列、右边溢出视口
   * （实测 1202px 视口 + 215px 副菜单：底色落在 107.5→1309.5，两端各偏 107.5px）。
   */
  bleedToViewport?: boolean;
};

/**
 * 通栏工具条：底色与 PageShell 的内容盒对齐，并按需铺满视口宽度。
 *
 * 底色始终画在盒子自身（`bg-(--ant-color-bg-container)`）——盒子占满内容区时这就够了，
 * 也是容器层级用法的全部；只有当盒子窄于内容区（PageShell 内）时才叠上
 * `.lucy-full-bleed-bar`，由 `::before` 把底色补到 `100vw`（见 index.css）。
 *
 * 补底色的伪元素**不动布局**：一旦用负 margin 或 `width: 100vw` 真去撑开元素，元素自身
 * 就变成满宽，`50% - 50vw` 这类居中偏移随即归零，控件会被推到视口左缘、与下方卡片错位
 * （实测差 298px）。伪元素不参与布局，控件位置完全不受影响。
 *
 * 已知边界：`100vw` 含页面级滚动条宽度。本仓 `#root` 是 `overflow: hidden`、长内容在内部
 * 容器滚动，没有页面级滚动条，故 `100vw` 恰等于可见宽度。若将来放开页面级滚动，
 * 需给伪元素补 `max-width: 100%` 收口。
 *
 * `isolate`（`isolation: isolate`）**不可省**：底色靠 `::before` 的 `z-index: -1` 铺设，
 * 而 `position: relative` + `z-index: auto` 不形成层叠上下文，该负层会向上冒泡到最近祖先
 * 的层叠上下文，于是被祖先自身的不透明背景盖住、底色整条不可见（实测给父级加背景色后
 * 工具条区域只剩父级背景）。建立自身层叠上下文后伪元素被约束在工具条内部。
 * 用 `isolate` 而非 `z-10`：后者会把整个工具条抬到兄弟元素之上（`UserToolbar` 因 sticky
 * 需要那个），而这里只需约束自己的伪元素，不该改变元素之间的 z序。
 *
 * 另注：与滚动列表（PageShell）相邻时，调用方需自行补 `z-10`——列表项常带定位/transform，
 * 按树序会盖在工具条之上、把 `shadow-lg` 整条吃掉（用户管理、知识库、模型供应商三处都已补）。
 */
export const FullBleedBar = ({
  children,
  className,
  innerClassName,
  bleedToViewport = true,
}: FullBleedBarProps) => {
  return (
    <div
      className={cn(
        'relative bg-(--ant-color-bg-container)',
        bleedToViewport && 'lucy-full-bleed-bar isolate',
        className,
      )}
    >
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
