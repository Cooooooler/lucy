import { ApiError } from '@/api/client';
import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeBaseVisibility,
  KnowledgeDocument,
  UpdateKnowledgeBaseRequest,
} from '@/api/types';
import {
  useAddDocument,
  useCreateKnowledgeBase,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useDocumentList,
  useKnowledgeBaseList,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import {
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { type ProColumns, ProTable } from '@ant-design/pro-components';
import { createFileRoute } from '@tanstack/react-router';
import {
  App,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Splitter,
  Table,
  type TableColumnsType,
  Tag,
  Typography,
  Upload,
  type UploadProps,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';

const { Text, Paragraph } = Typography;

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

function KnowledgePage() {
  const { message } = App.useApp();
  const list = useKnowledgeBaseList();
  const create = useCreateKnowledgeBase();
  const update = useUpdateKnowledgeBase();
  const remove = useDeleteKnowledgeBase();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [createForm] = Form.useForm<CreateKnowledgeBaseRequest>();
  const [editForm] = Form.useForm<UpdateKnowledgeBaseRequest>();

  // 默认选中第一条
  const currentId = selectedId ?? list.data?.list?.[0]?.id;

  function openCreate() {
    createForm.resetFields();
    createForm.setFieldsValue({ visibility: 'private' });
    setCreateOpen(true);
  }

  async function handleCreate() {
    const values = await createForm.validateFields();
    try {
      const created = await create.mutateAsync(values);
      message.success('创建成功');
      setCreateOpen(false);
      setSelectedId(created.id);
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  function openEdit(record: KnowledgeBase) {
    editForm.setFieldsValue({
      name: record.name,
      // 描述是 Record<string, never> | null；编辑表单按 string 处理
      description:
        record.description == null
          ? undefined
          : typeof record.description === 'string'
            ? record.description
            : undefined,
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
      if (currentId === id) setSelectedId(undefined);
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  const columns: ProColumns<KnowledgeBase>[] = [
    { title: '名称', dataIndex: 'name', ellipsis: true, width: 200 },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      width: 280,
      render: (_, r) => {
        const d = r.description;
        if (d == null) return '-';
        if (typeof d === 'string') return d;
        return '-';
      },
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 100,
      render: (_, r) => {
        const tag = visibilityTag[r.visibility] ?? {
          color: 'default',
          label: r.visibility,
        };
        return <Tag color={tag.color}>{tag.label}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (_, r) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 160,
      render: (_, record) => [
        <Button
          key="edit"
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => openEdit(record)}
        >
          编辑
        </Button>,
        <Popconfirm
          key="delete"
          title="删除知识库"
          description="将同时删除其下所有文档，确认删除？"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => handleDelete(record.id)}
        >
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <>
      <Splitter className="h-full" collapsible={{ motion: true }}>
        <Splitter.Panel collapsible defaultSize="40%" min="25%" max="60%">
          <ProTable<KnowledgeBase>
            rowKey="id"
            search={false}
            options={false}
            loading={list.isLoading}
            dataSource={list.data?.list ?? []}
            columns={columns}
            rowSelection={{
              type: 'radio',
              selectedRowKeys: currentId ? [currentId] : [],
              onChange: (keys) => setSelectedId(keys[0] as string | undefined),
            }}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              total: list.data?.total,
            }}
            toolBarRender={() => [
              <Button
                key="create"
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreate}
              >
                新建知识库
              </Button>,
            ]}
            dateFormatter="string"
          />
        </Splitter.Panel>
        <Splitter.Panel>
          {currentId ? (
            <DocumentPanel kbId={currentId} />
          ) : (
            <Flex
              className="h-full w-full"
              align="center"
              justify="center"
              vertical
              gap="middle"
            >
              <Empty description="请选择左侧知识库查看文档" />
            </Flex>
          )}
        </Splitter.Panel>
      </Splitter>

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
    </>
  );
}

function DocumentPanel({ kbId }: Readonly<{ kbId: string }>) {
  const { message } = App.useApp();
  const docs = useDocumentList(kbId);
  const add = useAddDocument();
  const remove = useDeleteDocument();

  const uploadProps: UploadProps = {
    multiple: false,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        await add.mutateAsync({ kbId, file });
        message.success(`已上传：${file.name}`);
      } catch (e) {
        if (e instanceof ApiError) message.error(e.message);
      }
      return false;
    },
  };

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync({ kbId, id });
      message.success('已删除');
    } catch (e) {
      if (e instanceof ApiError) message.error(e.message);
    }
  }

  const docColumns: TableColumnsType<KnowledgeDocument> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (title: string) => (
        <Space>
          <FileTextOutlined />
          <Text ellipsis>{title}</Text>
        </Space>
      ),
    },
    {
      title: '文件',
      dataIndex: 'fileId',
      ellipsis: true,
      width: 200,
      render: (id: string) => <Text type="secondary">{id}</Text>,
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="删除文档"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={() => handleDelete(record.id)}
        >
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Flex vertical className="h-full w-full gap-3">
      <Flex justify="space-between" align="center">
        <Text strong>知识库文档</Text>
        <Upload {...uploadProps}>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={add.isPending}
          >
            上传文档
          </Button>
        </Upload>
      </Flex>
      <Paragraph type="secondary" className="m-0!">
        支持向当前选中的知识库上传文档，列表按上传时间倒序展示。
      </Paragraph>
      <Table<KnowledgeDocument>
        rowKey="id"
        loading={docs.isLoading}
        dataSource={docs.data?.list ?? []}
        columns={docColumns}
        size="small"
        pagination={{
          pageSize: 10,
          showSizeChanger: false,
          total: docs.data?.total,
        }}
        scroll={{ y: 'calc(100% - 120px)' }}
      />
    </Flex>
  );
}
