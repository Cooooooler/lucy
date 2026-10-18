import { FullBleedBar } from '@/components/full-bleed-bar';
import { Button, Input, Upload } from 'antd';
import type { FC, ReactNode } from 'react';

/**
 * 可选文件类型：与后端 `content-extractor.ts` 的 `SUPPORTED_DOCUMENT_EXTS` 对齐。
 * 后端仍会再校验扩展名、大小与（pdf）魔数，这里只是把明显不支持的格式挡在选择框外；
 * 两处字面量目前各自维护，若要单一来源需把它挪进 `@lucy/shared`（本次不做）。
 */
const ACCEPT = '.txt,.md,.pdf,.docx';

export type DocumentToolbarProps = {
  /** 知识库名称：详情尚未就绪时为 undefined，占位显示「知识库」 */
  kbName?: string;
  /** 知识库描述：为空则不渲染描述行 */
  kbDescription?: string;
  /** 返回列表的入口：由路由注入（工具条不认识路由，与卡片热区同一分工） */
  backLink: ReactNode;
  /** 关键字搜索（已 trim 首尾空白） */
  onSearch: (value: string) => void;
  /** 选中文件后回调；上传由路由持有的 mutation 执行 */
  onUpload: (file: File) => void;
  /** 上传进行中：禁用入口，避免并发上传同一个知识库 */
  isUploading: boolean;
};

/**
 * 知识库详情页的工具条：左侧返回入口 + 知识库信息，右侧上传文档 + 关键字搜索。
 *
 * 与列表页的 `KnowledgeToolbar` 共用同一套外壳参数（FullBleedBar + lucy-page-gutter + z-10），
 * 两页的内容左缘与横条高度因此保持一致；`z-10` 见列表页同名说明（滚动容器里的表格项会盖住横条）。
 */
export const DocumentToolbar: FC<DocumentToolbarProps> = ({
  kbName,
  kbDescription,
  backLink,
  onSearch,
  onUpload,
  isUploading,
}) => (
  <FullBleedBar
    bleedToViewport={false}
    className="lucy-page-gutter z-10 shrink-0 py-6 shadow-lg"
  >
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
    <div className="flex shrink-0 items-center gap-4">
      <Upload
        accept={ACCEPT}
        showUploadList={false}
        disabled={isUploading}
        // 返回 false 阻止 antd 自行上传：请求由路由的 useAddDocument 发起（带 Bearer 与信封解包）
        beforeUpload={(file) => {
          onUpload(file);
          return false;
        }}
      >
        <Button loading={isUploading} disabled={isUploading}>
          上传文档
        </Button>
      </Upload>
      <Input.Search
        allowClear
        placeholder="按文件名或内容搜索"
        className="w-60"
        onSearch={(value) => onSearch(value.trim())}
      />
    </div>
  </FullBleedBar>
);
