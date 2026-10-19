import { Button, Upload } from 'antd';
import type { FC } from 'react';

/**
 * 可选文件类型：与后端 `content-extractor.ts` 的 `SUPPORTED_DOCUMENT_EXTS` 对齐。
 * 后端仍会再校验扩展名、大小与（pdf）魔数，这里只是把明显不支持的格式挡在选择框外；
 * 两处字面量目前各自维护，若要单一来源需把它挪进 `@lucy/shared`（本次不做）。
 */
const ACCEPT = '.txt,.md,.pdf,.docx';

export type DocumentUploadButtonProps = {
  /** 选中文件后回调；上传由路由持有的 mutation 执行 */
  onUpload: (file: File) => void;
  /** 上传进行中：禁用入口，避免并发上传同一个知识库 */
  isUploading: boolean;
};

/** 文档上传入口：由详情页放进 ProTable 的 `toolBarRender` */
export const DocumentUploadButton: FC<DocumentUploadButtonProps> = ({
  onUpload,
  isUploading,
}) => (
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
);
