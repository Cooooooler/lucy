import { errorMessageOf } from '@/api/client';
import type { ModelProviderType } from '@/api/types';
import { MODEL_TYPE_OPTIONS } from '@/components/model-provider/model-provider-labels.ts';
import {
  useModelProviderDefaults,
  useModelProvidersByType,
  useUpdateModelProviderDefaults,
} from '@/hooks/use-model-provider';
import { App, Form, Modal, Select } from 'antd';
import { useMemo, type FC } from 'react';

type DefaultModelSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

type FormValues = Partial<Record<ModelProviderType, string | undefined>>;

/** 单行：某模型类型的默认模型下拉（选项即该类型下的全部模型，按打开状态惰性加载） */
const DefaultModelRow: FC<{
  type: ModelProviderType;
  label: string;
  enabled: boolean;
}> = ({ type, label, enabled }) => {
  const { models, isLoading } = useModelProvidersByType(type, enabled);
  return (
    <Form.Item name={type} label={label}>
      <Select
        allowClear
        loading={isLoading}
        placeholder="未设置"
        options={models.map((model) => ({
          label: model.name,
          value: model.id,
        }))}
      />
    </Form.Item>
  );
};

/**
 * 默认模型设置：为每一种模型类型各选一个模型。
 *
 * 读取后回填表单；保存按后端整体替换语义提交**全部**类型（未选为 null），
 * 因此清空某一类型只需在下拉里清除后保存。
 */
export const DefaultModelSettingsModal: FC<DefaultModelSettingsModalProps> = ({
  open,
  onClose,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const defaultsQuery = useModelProviderDefaults(open);
  const updateMutation = useUpdateModelProviderDefaults();

  // 关闭时 Form 随 Modal 销毁（destroyOnHidden + preserve=false），重新打开会重新挂载。
  // 回填必须走 `initialValues`（渲染期写入 store），不能用 effect 里 setFieldsValue：
  // 重开时 effect 与 Form.Item 注册同轮执行，字段尚未注册，值会被丢弃（首次打开只是
  // 因为数据晚到才碰巧正常）。数据从无到有时靠 key 强制重挂，让新的 initialValues 生效。
  const initialValues = useMemo<FormValues>(() => {
    const values: FormValues = {};
    for (const item of defaultsQuery.data?.defaults ?? []) {
      values[item.type] = item.modelProviderId ?? undefined;
    }
    return values;
  }, [defaultsQuery.data]);

  const handleSubmit = async () => {
    const values = form.getFieldsValue();
    try {
      await updateMutation.mutateAsync({
        defaults: MODEL_TYPE_OPTIONS.map(({ value: type }) => ({
          type,
          modelProviderId: values[type] ?? null,
        })),
      });
      onClose();
    } catch (e) {
      message.error(errorMessageOf(e, '保存失败，请稍后重试'));
    }
  };

  return (
    <Modal
      title="默认模型设置"
      open={open}
      destroyOnHidden
      confirmLoading={updateMutation.isPending}
      okText="保存"
      cancelText="取消"
      onOk={handleSubmit}
      onCancel={onClose}
    >
      {open ? (
        <Form
          key={JSON.stringify(initialValues)}
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={initialValues}
        >
          {MODEL_TYPE_OPTIONS.map(({ label, value }) => (
            <DefaultModelRow
              key={value}
              type={value}
              label={label}
              enabled={open}
            />
          ))}
        </Form>
      ) : null}
    </Modal>
  );
};
