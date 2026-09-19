import { errorMessageOf } from '@/api/client';
import type { KnowledgeBase } from '@/api/types';
import {
  useCreateKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { App, Button, Drawer, Form, Input, Segmented } from 'antd';
import type { FC } from 'react';

/** 表单抽屉的可见性选项（不含"全部"，默认 private） */
const FORM_VISIBILITY_OPTIONS: {
  label: string;
  value: 'private' | 'public';
}[] = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

type KnowledgeFormDrawerProps = {
  open: boolean;
  mode: 'create' | 'edit';
  /** 编辑态的当前知识库；创建态不传 */
  kb?: KnowledgeBase;
  onClose: () => void;
};

/**
 * 单例知识库表单抽屉：创建/编辑共用一套 Form 与 mutation。
 *
 * 开关与目标由路由持有（卡片/工具栏只发意图），避免每张卡片各自挂一套
 * `Form.useForm()` + `<Drawer>` + `useUpdateKnowledgeBase()` 实例。
 * 同一时刻只能编辑一个知识库；`destroyOnHidden` + `preserve={false}` +
 * `key={mode + id}` 保证切换对象时不残留上一次的字段值。
 */
export const KnowledgeFormDrawer: FC<KnowledgeFormDrawerProps> = ({
  open,
  mode,
  kb,
  onClose,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  // 两个 mutation 无条件调用，保证 hooks 顺序稳定；按 mode 选用
  const createMutation = useCreateKnowledgeBase();
  const updateMutation = useUpdateKnowledgeBase();
  const isEdit = mode === 'edit';

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
    const trimmedDescription = values.description?.trim();
    const input = {
      name: values.name.trim(),
      // 后端 PATCH 语义：description 省略 = 不修改，空串 = 清空。
      // 编辑态必须保留空串，否则用户「清空描述」会被静默忽略；
      // 创建态用 undefined，让后端落 null 而非空串（沿用改造前行为）。
      description: isEdit
        ? (trimmedDescription ?? undefined)
        : trimmedDescription || undefined,
      visibility: values.visibility,
    };
    try {
      if (isEdit && kb) {
        await updateMutation.mutateAsync({ id: kb.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      // 成功提示（「知识库创建/更新成功」）由后端 message 经全局桥弹出
      onClose();
    } catch (e) {
      message.error(
        errorMessageOf(
          e,
          isEdit ? '更新失败，请稍后重试' : '创建失败，请稍后重试',
        ),
      );
    }
  };

  return (
    <Drawer
      title={isEdit ? '编辑知识库' : '新增知识库'}
      size="large"
      open={open}
      destroyOnHidden
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={
              isEdit ? updateMutation.isPending : createMutation.isPending
            }
            onClick={handleSubmit}
          >
            {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      }
    >
      <Form
        key={mode + (kb?.id ?? '')}
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          name: kb?.name ?? '',
          description: kb?.description ?? undefined,
          visibility: kb?.visibility ?? 'private',
        }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, whitespace: true, message: '请输入知识库名称' },
          ]}
        >
          <Input maxLength={20} placeholder="请输入知识库名称" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea
            maxLength={200}
            showCount
            rows={4}
            placeholder="请输入描述（可选）"
          />
        </Form.Item>
        <Form.Item name="visibility" label="可见性">
          <Segmented options={FORM_VISIBILITY_OPTIONS} block />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
