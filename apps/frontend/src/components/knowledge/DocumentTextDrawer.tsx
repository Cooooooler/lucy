import { errorMessageOf } from '@/api/client';
import type { KnowledgeDocumentListItem } from '@/api/types';
import { useDocument } from '@/hooks/use-knowledge';
import { Drawer, Result, Spin } from 'antd';
import {
  lazy,
  Suspense,
  useDeferredValue,
  type FC,
  type ReactNode,
} from 'react';

// Markdown 引擎（marked + dompurify 等，约 44KB gzip）只在点开「查看」后需要，
// 按需加载避免详情页首屏为抽屉里可能用不到的能力买单。
const XMarkdown = lazy(() => import('@ant-design/x-markdown'));

export type DocumentTextDrawerProps = {
  kbId: string;
  /** 目标文档：null 表示关闭。传列表项即可——标题用原始文件名，不必等详情回来 */
  doc: KnowledgeDocumentListItem | null;
  onClose: () => void;
};

/**
 * 解析文本抽屉：按 id 拉取文档的解析全文（`useDocument`，doc 为 null 时自身禁用请求）。
 *
 * 正文按 Markdown 渲染；文档内容来自用户上传，`escapeRawHtml` 让原始 HTML 只作为文本展示，
 * 避免注入。`destroyOnHidden` 让关闭后不再保留整篇文本的 DOM。
 */
export const DocumentTextDrawer: FC<DocumentTextDrawerProps> = ({
  kbId,
  doc,
  onClose,
}) => {
  const query = useDocument(kbId, doc?.id);
  // 正文可达 MB 级：让抽屉先提交，Markdown 解析放到 transition 里，避免打开时整段卡住
  const content = useDeferredValue(query.data?.content);

  // 查询加载与懒加载 chunk 共用同一个占位
  const loadingNode = (
    <div
      data-testid="document-text-loading"
      className="flex justify-center py-16"
    >
      <Spin />
    </div>
  );

  // 显式分支而非嵌套三元（sonar S3358）：四种状态各自独立，读起来也更容易扩展
  let body: ReactNode;
  if (query.isLoading) {
    body = loadingNode;
  } else if (query.isError) {
    body = (
      <Result
        status="error"
        title="解析文本加载失败"
        subTitle={errorMessageOf(query.error, '请稍后重试')}
      />
    );
  } else if (content) {
    body = (
      <Suspense fallback={loadingNode}>
        <XMarkdown
          content={content}
          className="text-sm break-words"
          openLinksInNewTab
          escapeRawHtml
        />
      </Suspense>
    );
  } else {
    body = <div className="text-sm">（没有可展示的解析文本）</div>;
  }

  return (
    <Drawer
      title={doc?.originalName ?? ''}
      open={!!doc}
      onClose={onClose}
      destroyOnHidden
      // antd 6 起 width 弃用（Drawer 已合并到 size）
      size={640}
    >
      {body}
    </Drawer>
  );
};
