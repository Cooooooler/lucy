import { errorMessageOf } from '@/api/client';
import type { KnowledgeDocumentListItem } from '@/api/types';
import { DocumentTextDrawer } from '@/components/knowledge/DocumentTextDrawer';
import { DocumentToolbar } from '@/components/knowledge/DocumentToolbar';
import { formatBytes } from '@/components/lib/utils';
import { PageShell } from '@/components/page-shell';
import {
  KNOWLEDGE_PAGE_SIZE,
  useAddDocument,
  useDeleteDocument,
  useDocumentList,
  useKnowledgeBase,
} from '@/hooks/use-knowledge';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { createFileRoute, Link } from '@tanstack/react-router';
import { App, Button, Empty, Result } from 'antd';
import dayjs from 'dayjs';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';

export type KnowledgeDetailPageProps = {
  /** 知识库 ID：由路由传入，页面因此不依赖 Router 上下文（用例只 mock 掉 Link 即可直接渲染） */
  kbId: string;
};

/**
 * 知识库详情页：页头是知识库信息与上传入口，主体是该知识库的文档（文件）表格。
 *
 * 取舍说明：
 * - 列表走**页码分页**（`useDocumentList`）：表格要页码与总数，游标分页表达不了；
 *   列表页的卡片仍是游标分页 + 虚拟网格，两种形态各自匹配交互。
 * - 删除/上传的 mutation 与提示都收在路由这一层，工具条与抽屉只上报意图。
 * - 上传成功后回到第 1 页：新文档按 `created_at DESC` 排在最前，停在旧页会看不到刚上传的文件。
 */
export const KnowledgeDetailPage: FC<KnowledgeDetailPageProps> = ({ kbId }) => {
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [viewing, setViewing] = useState<KnowledgeDocumentListItem | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);

  const kbQuery = useKnowledgeBase(kbId);
  const listQuery = useMemo(
    () => ({
      page,
      pageSize: KNOWLEDGE_PAGE_SIZE,
      keyword: keyword || undefined,
    }),
    [page, keyword],
  );
  const query = useDocumentList(kbId, listQuery);
  const rows = useMemo(() => query.data?.list ?? [], [query.data]);

  const { mutateAsync: addDocument } = useAddDocument();
  const { mutateAsync: removeDocument } = useDeleteDocument();

  // 删除确认框的 onOk 在闭包里执行：用 ref 读最新的页码与行数，避免回调依赖 page/rows
  // 而每轮重建（连带 columns memo 失效）。写入放 effect 而非渲染期（渲染期写 ref 在并发渲染
  // 下可能写入未提交的值），onOk 在交互时执行，effect 早已同步——同用户管理页的处理。
  const pageRef = useRef(page);
  const rowsRef = useRef(rows);
  useEffect(() => {
    pageRef.current = page;
    rowsRef.current = rows;
  }, [page, rows]);

  const handleDelete = useCallback(
    (doc: KnowledgeDocumentListItem) => {
      modal.confirm({
        title: '删除文档',
        content: `确定要删除「${doc.originalName}」吗？此操作不可恢复。`,
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          // 末页最后一条被删时先回退页码再删：invalidate 的重拉直接命中目标页，
          // 避免先拉空页再翻页的闪动
          if (rowsRef.current.length <= 1 && pageRef.current > 1) {
            setPage(pageRef.current - 1);
          }
          // 成功提示（「文档已删除」）由后端 message 经全局桥弹出
          return removeDocument({ kbId, id: doc.id }).catch((e: unknown) => {
            message.error(errorMessageOf(e, '删除失败，请稍后重试'));
            throw e;
          });
        },
      });
    },
    [kbId, message, modal, removeDocument],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        await addDocument({ kbId, file });
        setPage(1);
      } catch (e) {
        message.error(errorMessageOf(e, '上传失败，请稍后重试'));
      } finally {
        setUploading(false);
      }
    },
    [addDocument, kbId, message],
  );

  const columns: ProColumns<KnowledgeDocumentListItem>[] = useMemo(
    () => [
      { title: '文件名', dataIndex: 'originalName', ellipsis: true },
      { title: '类型', dataIndex: 'ext', width: 100 },
      {
        title: '大小',
        dataIndex: 'size',
        width: 120,
        render: (_, record) => formatBytes(record.size),
      },
      {
        title: '上传时间',
        dataIndex: 'createdAt',
        width: 180,
        render: (_, record) =>
          dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '操作',
        valueType: 'option',
        width: 140,
        render: (_, record) => [
          <Button
            key="view"
            type="link"
            size="small"
            onClick={() => setViewing(record)}
          >
            查看
          </Button>,
          <Button
            key="delete"
            type="link"
            size="small"
            danger
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>,
        ],
      },
    ],
    [handleDelete],
  );

  // 知识库不存在 / 无权访问：整页错误态。此时文档列表必然也拿不到，渲染表格只会多一个报错块。
  if (kbQuery.isError) {
    return (
      <PageShell>
        <Result
          status="error"
          title="知识库加载失败"
          subTitle={errorMessageOf(kbQuery.error, '请稍后重试')}
          extra={
            <Link to="/knowledge" aria-label="返回知识库列表">
              返回知识库列表
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell height="fill">
      <DocumentToolbar
        kbName={kbQuery.data?.name}
        kbDescription={kbQuery.data?.description}
        backLink={
          <Link
            to="/knowledge"
            aria-label="返回知识库列表"
            title="返回知识库列表"
            className="flex size-8 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:text-[#45b7d1]"
          >
            <ArrowLeftOutlined />
          </Link>
        }
        onSearch={(value) => {
          setKeyword(value);
          setPage(1);
        }}
        onUpload={(file) => void handleUpload(file)}
        isUploading={uploading}
      />
      {/* 与列表页同一结构：工具条占满内容区，表格在下方自然高度容器里 */}
      <div className="min-h-0 flex-1 py-4">
        {query.isError ? (
          <Result
            status="error"
            title="文档加载失败"
            subTitle={errorMessageOf(query.error, '请稍后重试')}
            extra={
              <Button type="link" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        ) : (
          <ProTable<KnowledgeDocumentListItem>
            rowKey="id"
            loading={query.isLoading}
            dataSource={rows}
            columns={columns}
            search={false}
            options={false}
            dateFormatter="string"
            pagination={{
              current: page,
              pageSize: KNOWLEDGE_PAGE_SIZE,
              total: query.data?.total ?? 0,
              showSizeChanger: false,
              onChange: (next) => setPage(next),
            }}
            locale={{
              emptyText: (
                <Empty
                  className="py-16"
                  description={keyword ? '没有匹配的文档' : '暂无文档，可上传'}
                />
              ),
            }}
          />
        )}
      </div>
      <DocumentTextDrawer
        kbId={kbId}
        doc={viewing}
        onClose={() => setViewing(null)}
      />
    </PageShell>
  );
};

export const Route = createFileRoute('/_layout/knowledge/$kbId')({
  component: KnowledgeDetailRoute,
});

function KnowledgeDetailRoute() {
  const { kbId } = Route.useParams();
  return <KnowledgeDetailPage kbId={kbId} />;
}
