import { FullBleedBar } from '@/components/full-bleed-bar';
import type { FC, ReactNode } from 'react';

export type PageToolbarProps = {
  /** 左侧插槽：筛选器、返回入口、标题等 */
  left?: ReactNode;
  /** 右侧操作插槽：排在搜索框左侧的主按钮、刷新等 */
  actions?: ReactNode;
  /** 右侧搜索框插槽 */
  search?: ReactNode;
};

/**
 * 页面头部工具条：左侧内容 + 右侧操作区/搜索框的统一外壳。
 *
 * 与 PageShell 平级（自带 `.lucy-page-gutter`），盒子已占满内容区，故不挂 `100vw`
 * 伪元素——否则带副菜单时底色会左溢进副菜单列、右溢出视口（见 FullBleedBar 的
 * `bleedToViewport` 说明）。
 *
 * `z-10` 不可省：下方 PageShell 是滚动容器，列表项/卡片带定位或 transform，按树序会盖在
 * 工具条之上、把 `shadow-lg` 整条吃掉，抬一层即可。
 */
export const PageToolbar: FC<PageToolbarProps> = ({
  left,
  actions,
  search,
}) => (
  <FullBleedBar
    bleedToViewport={false}
    className="lucy-page-gutter z-10 shrink-0 py-6 shadow-lg"
  >
    {left}
    {search ? (
      <div className="w-sm">
        <div className="flex gap-4">
          {actions}
          {search}
        </div>
      </div>
    ) : actions ? (
      <div className="flex shrink-0 items-center gap-4">{actions}</div>
    ) : null}
  </FullBleedBar>
);
