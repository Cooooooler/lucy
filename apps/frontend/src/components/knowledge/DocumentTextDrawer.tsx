import { errorMessageOf } from '@/api/client';
import type { KnowledgeDocumentListItem } from '@/api/types';
import { useDocument } from '@/hooks/use-knowledge';
import { Drawer, Result, Spin } from 'antd';
import type { FC } from 'react';

export type DocumentTextDrawerProps = {
  kbId: string;
  /** 目标文档：null 表示关闭。传列表项即可——标题用原始文件名，不必等详情回来 */
  doc: KnowledgeDocumentListItem | null;
  onClose: () => void;
};

/**
 * 解析文本抽屉：按 id 拉取文档的解析全文（`useDocument`，doc 为 null 时自身禁用请求）。
 *
 * 正文可达 MB 级，故只做 `whitespace-pre-wrap` + 抽屉内滚动，不做高亮或富文本；
 * `destroyOnHidden` 让关闭后不再保留整篇文本的 DOM。
 */
export const DocumentTextDrawer: FC<DocumentTextDrawerProps> = ({
  kbId,
  doc,
  onClose,
}) => {
  const query = useDocument(kbId, doc?.id);

  return (
    <Drawer
      title={doc?.originalName ?? ''}
      open={!!doc}
      onClose={onClose}
      destroyOnHidden
      // antd 6 起 width 弃用（Drawer 已合并到 size）
      size={640}
    >
      {query.isLoading ? (
        <div
          data-testid="document-text-loading"
          className="flex justify-center py-16"
        >
          <Spin />
        </div>
      ) : query.isError ? (
        <Result
          status="error"
          title="解析文本加载失败"
          subTitle={errorMessageOf(query.error, '请稍后重试')}
        />
      ) : (
        <div className="text-sm break-words whitespace-pre-wrap">
          {query.data?.content || '（没有可展示的解析文本）'}
        </div>
      )}
    </Drawer>
  );
};
