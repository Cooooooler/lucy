import { PageToolbar } from '@/components/page-toolbar';
import type { FC, ReactNode } from 'react';

export type DocumentToolbarProps = {
  /** 知识库名称：详情尚未就绪时为 undefined，占位显示「知识库」 */
  kbName?: string;
  /** 知识库描述：为空则不渲染描述行 */
  kbDescription?: string;
  /** 返回列表的入口：由路由注入（工具条不认识路由，与卡片热区同一分工） */
  backLink: ReactNode;
};

/**
 * 知识库详情页的工具条：返回入口 + 知识库信息。
 * 关键字搜索与上传入口都由下方 ProTable 承担（内置查询表单 + `toolBarRender`）。
 */
export const DocumentToolbar: FC<DocumentToolbarProps> = ({
  kbName,
  kbDescription,
  backLink,
}) => (
  <PageToolbar
    left={
      <div className="flex min-w-0 items-center gap-3">
        {backLink}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold">
            {kbName ?? '知识库'}
          </span>
          {kbDescription ? (
            <span className="truncate text-xs text-gray-500">
              {kbDescription}
            </span>
          ) : null}
        </div>
      </div>
    }
  />
);
