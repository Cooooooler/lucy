import { ApiError } from '@/api/client';
import { useCreateKnowledgeBase } from '@/hooks/use-knowledge';
import { App, Button, Drawer, Form, Input, Segmented } from 'antd';
import type { FC } from 'react';
import { useState } from 'react';

export type VisibilityFilter = 'all' | 'private' | 'public';

export const VISIBILITY_OPTIONS: { label: string; value: VisibilityFilter }[] =
  [
    { label: '全部', value: 'all' },
    { label: '私有', value: 'private' },
    { label: '公开', value: 'public' },
  ];

/** 新增知识库表单的可见性选项（不含"全部"，默认 private） */
const FORM_VISIBILITY_OPTIONS: {
  label: string;
  value: 'private' | 'public';
}[] = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

type KnowledgeToolbarProps = {
  visibility: VisibilityFilter;
  onVisibilityChange: (value: VisibilityFilter) => void;
  onSearch: (value: string) => void;
};

export const KnowledgeToolbar: FC<KnowledgeToolbarProps> = ({
  visibility,
  onVisibilityChange,
  onSearch,
}) => {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const createMutation = useCreateKnowledgeBase();
  const [form] = Form.useForm();

  const handleSubmit = async () => {
    let values: {
      name: string;
      description?: string;
      visibility: 'private' | 'public';
    };
    try {
      values = await form.validateFields();
    } catch {
      // 校验未通过：表单自身会展示错误提示，无需额外处理
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        visibility: values.visibility,
      });
      message.success('知识库创建成功');
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        message.error(e.message);
      } else {
        message.error('创建失败，请稍后重试');
      }
    }
  };

  return (
    <div className="sticky top-0 z-10 flex w-full items-center justify-between gap-4 bg-(--ant-color-bg-container) px-4 py-6 shadow-lg sm:px-6 md:px-8">
      <Segmented<VisibilityFilter>
        options={VISIBILITY_OPTIONS}
        value={visibility}
        onChange={onVisibilityChange}
      />
      <div className="w-sm">
        <div className="flex gap-4">
          <Button onClick={() => setOpen(true)}>新增知识库</Button>
          <Input.Search
            allowClear
            placeholder="按名称搜索知识库"
            onSearch={(value) => onSearch(value.trim())}
          />
        </div>
      </div>
      <Drawer
        title="新增知识库"
        size="large"
        open={open}
        destroyOnHidden
        onClose={() => setOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={createMutation.isPending}
              onClick={handleSubmit}
            >
              创建
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入知识库名称' }]}
          >
            <Input maxLength={100} placeholder="请输入知识库名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea
              maxLength={200}
              showCount
              rows={4}
              placeholder="请输入描述（可选）"
            />
          </Form.Item>
          <Form.Item name="visibility" label="可见性" initialValue="private">
            <Segmented options={FORM_VISIBILITY_OPTIONS} block />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};
