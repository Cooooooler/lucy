import { ApiError } from '@/api/client';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeBaseVisibility,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeBaseList,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import {
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { createFileRoute } from '@tanstack/react-router';
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';

const { Text, Paragraph } = Typography;
const { Search } = Input;

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgePage,
});

const visibilityOptions: { label: string; value: KnowledgeBaseVisibility }[] = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

const visibilityTag: Record<
  KnowledgeBaseVisibility,
  { color: string; label: string }
> = {
  private: { color: 'default', label: '私有' },
  public: { color: 'blue', label: '公开' },
};

function describeDescription(d: KnowledgeBase['description']): string | null {
  if (d == null) return null;
  if (typeof d === 'string') return d;
  return null;
}

function KnowledgePage() {
  const { message } = App.useApp();
  const list = useKnowledgeBaseList();
  const create = useCreateKnowledgeBase();
  const update = useUpdateKnowledgeBase();
  const remove = useDeleteKnowledgeBase();
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [createForm] = Form.useForm<CreateKnowledgeBaseRequest>();
  const [editForm] = Form.useForm<UpdateKnowledgeBaseRequest>();

  const data = useMemo(() => list.data?.list ?? [], [list.data?.list]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return data;
    return data.filter((kb) => {
      const desc = describeDescription(kb.description) ?? '';
      return (
        kb.name.toLowerCase().includes(kw) || desc.toLowerCase().includes(kw)
      );
    });
  }, [data, keyword]);

  function openCreate() {
    createForm.resetFields();
    createForm.setFieldsValue({ visibility: 'private' });
    setCreateOpen(true);
  }

  async function handleCreate() {
    const values = await createForm.validateFields();
    try {
      await create.mutateAsync(values);
      message.success('创建成功');
      setCreateOpen(false);
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  function openEdit(record: KnowledgeBase) {
    editForm.setFieldsValue({
      name: record.name,
      description: describeDescription(record.description) ?? undefined,
      visibility: record.visibility,
    });
    setEditing(record);
  }

  async function handleEdit() {
    if (!editing) return;
    const values = await editForm.validateFields();
    try {
      await update.mutateAsync({ id: editing.id, input: values });
      message.success('已更新');
      setEditing(null);
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync(id);
      message.success('已删除');
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  return (
    <div className="box-border flex h-full w-full flex-col gap-4 px-8 pt-8">
      <div className="box-border flex flex-row-reverse items-center gap-4">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建知识库
        </Button>
        <Search
          allowClear
          placeholder="搜索名称或描述"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 240 }}
        />
      </div>
      {list.isLoading ? (
        <Flex gap="middle" wrap="wrap">
          {Array.from({ length: 6 }).map((i) => (
            <Card key={`skeleton-${i}`} style={{ width: 280 }} loading>
              <Skeleton active paragraph={{ rows: 2 }} />
            </Card>
          ))}
        </Flex>
      ) : filtered.length === 0 ? (
        <Flex className="flex-1" align="center" justify="center" vertical>
          <Empty
            description={
              keyword ? '没有匹配的知识库' : '还没有知识库，点击右上角新建'
            }
          />
        </Flex>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {filtered.map((kb) => {
            const desc = describeDescription(kb.description);
            const tag = visibilityTag[kb.visibility] ?? {
              color: 'default',
              label: kb.visibility,
            };
            return (
              <Card
                key={kb.id}
                hoverable
                styles={{
                  body: { display: 'flex', flexDirection: 'column', gap: 12 },
                }}
                actions={[
                  <Tooltip key="edit" title="编辑">
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => openEdit(kb)}
                      aria-label="编辑"
                    />
                  </Tooltip>,
                  <Popconfirm
                    key="delete"
                    title="删除知识库"
                    description="将同时删除其下所有文档，确认删除？"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => handleDelete(kb.id)}
                  >
                    <Tooltip title="删除">
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label="删除"
                      />
                    </Tooltip>
                  </Popconfirm>,
                ]}
              >
                <Flex align="center" gap="small">
                  <Flex
                    align="center"
                    justify="center"
                    className="bg-(--ant-color-fill-tertiary) text-(--ant-color-primary)"
                    style={{ width: 40, height: 40, borderRadius: 8 }}
                  >
                    <DatabaseOutlined style={{ fontSize: 20 }} />
                  </Flex>
                  <Flex vertical gap={2} className="min-w-0 flex-1">
                    <Text strong ellipsis>
                      {kb.name}
                    </Text>
                    <Tag
                      color={tag.color}
                      className="m-0! w-fit"
                      style={{ marginInlineStart: 0 }}
                    >
                      {tag.label}
                    </Tag>
                  </Flex>
                </Flex>
                <Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2, expandable: false }}
                  className="m-0! text-sm"
                >
                  {desc ?? '暂无描述'}
                </Paragraph>
                <Text type="secondary" className="text-xs">
                  创建于 {dayjs(kb.createdAt).format('YYYY-MM-DD HH:mm')}
                </Text>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        title="新建知识库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={create.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input maxLength={100} placeholder="知识库名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="可选，简要说明用途"
            />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="可见性"
            rules={[{ required: true }]}
          >
            <Radio.Group options={visibilityOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑知识库"
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={handleEdit}
        confirmLoading={update.isPending}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="可见性"
            rules={[{ required: true }]}
          >
            <Radio.Group options={visibilityOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
