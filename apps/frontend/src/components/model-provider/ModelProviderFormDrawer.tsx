import { errorMessageOf } from '@/api/client';
import type {
  CreateModelProviderRequest,
  ModelProvider,
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from '@/api/types';
import {
  MODEL_TYPE_OPTIONS,
  PROTOCOL_OPTIONS,
  VENDOR_DEFAULT_BASE_URL,
  VENDOR_OPTIONS,
} from '@/components/model-provider/model-provider-labels.ts';
import {
  useCreateModelProvider,
  useUpdateModelProvider,
} from '@/hooks/use-model-provider';
import {
  MODEL_API_KEY_MAX_LENGTH,
  MODEL_BASE_URL_MAX_LENGTH,
  MODEL_CONTEXT_LENGTH_MAX,
  MODEL_CONTEXT_LENGTH_MIN,
  MODEL_PROVIDER_NAME_MAX_LENGTH,
} from '@lucy/shared';
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
} from 'antd';
import type { FC } from 'react';

type ModelProviderFormDrawerProps = {
  open: boolean;
  mode: 'create' | 'edit';
  /** 编辑态的当前模型；创建态不传 */
  model?: ModelProvider;
  onClose: () => void;
};

type FormValues = {
  name: string;
  vendor: ModelProviderVendor;
  type: ModelProviderType;
  apiKey?: string;
  baseUrl: string;
  protocol: ModelProviderProtocol;
  contextLength: number;
};

/**
 * 单例模型表单抽屉：创建/编辑共用一套 Form 与 mutation。
 *
 * 开关与目标由路由持有（卡片/工具栏只发意图）。`destroyOnHidden` + `preserve={false}` +
 * `key={mode + id}` 保证切换对象时不残留上一次的字段值。
 * 编辑态 API Key 留空表示不修改（沿用后端 PATCH 语义）。
 */
export const ModelProviderFormDrawer: FC<ModelProviderFormDrawerProps> = ({
  open,
  mode,
  model,
  onClose,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  // 两个 mutation 无条件调用，保证 hooks 顺序稳定；按 mode 选用
  const createMutation = useCreateModelProvider();
  const updateMutation = useUpdateModelProvider();
  const isEdit = mode === 'edit';
  // 协议只对 OpenAI 生效（responses → ChatOpenAI.useResponsesApi），故仅 OpenAI 的 LLM 展示
  const type = Form.useWatch('type', form) ?? model?.type ?? 'llm';
  const vendor = Form.useWatch('vendor', form) ?? model?.vendor ?? 'openai';
  const showProtocol = type === 'llm' && vendor === 'openai';
  // ollama 通常免鉴权，Key 选填；其余供应商必填
  const apiKeyRequired = vendor !== 'ollama';

  /** 切换供应商时回填默认 Base URL（用户已手填其它值则不覆盖） */
  const handleVendorChange = (next: ModelProviderVendor) => {
    const current = form.getFieldValue('baseUrl') as string | undefined;
    if (!current || Object.values(VENDOR_DEFAULT_BASE_URL).includes(current)) {
      form.setFieldValue('baseUrl', VENDOR_DEFAULT_BASE_URL[next]);
    }
  };

  const handleSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      // 校验未通过：表单自身会展示错误提示
      return;
    }
    const apiKey = values.apiKey?.trim();
    // 协议只对 OpenAI 的 LLM 有意义：其余情况不发送（创建时后端取默认，编辑时保留原值）
    const sendProtocol = values.type === 'llm' && values.vendor === 'openai';
    const base: Omit<CreateModelProviderRequest, 'apiKey'> = {
      name: values.name.trim(),
      type: values.type,
      vendor: values.vendor,
      baseUrl: values.baseUrl.trim(),
      contextLength: values.contextLength,
      ...(sendProtocol ? { protocol: values.protocol } : {}),
    };
    try {
      if (isEdit && model) {
        // 编辑态省略 apiKey 表示不修改（后端 PATCH 语义）
        await updateMutation.mutateAsync({
          id: model.id,
          input: apiKey ? { ...base, apiKey } : base,
        });
      } else {
        if (values.vendor !== 'ollama' && !apiKey) {
          form.setFields([{ name: 'apiKey', errors: ['请输入 API Key'] }]);
          return;
        }
        // ollama 留空则不发送 apiKey（后端存空串）
        await createMutation.mutateAsync(apiKey ? { ...base, apiKey } : base);
      }
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
      title={isEdit ? '编辑模型' : '新增模型'}
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
        key={mode + (model?.id ?? '')}
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          name: model?.name ?? '',
          vendor: model?.vendor ?? 'openai',
          type: model?.type ?? 'llm',
          baseUrl: model?.baseUrl ?? '',
          protocol: model?.protocol ?? 'chat-completions',
          contextLength: model?.contextLength ?? 32768,
        }}
      >
        <Form.Item
          name="name"
          label="模型名称"
          rules={[
            { required: true, whitespace: true, message: '请输入模型名称' },
          ]}
        >
          <Input
            maxLength={MODEL_PROVIDER_NAME_MAX_LENGTH}
            placeholder="如 gpt-4o-mini"
          />
        </Form.Item>
        <Form.Item
          name="vendor"
          label="模型供应商"
          rules={[{ required: true, message: '请选择模型供应商' }]}
        >
          <Select options={VENDOR_OPTIONS} onChange={handleVendorChange} />
        </Form.Item>
        <Form.Item name="type" label="模型类型" rules={[{ required: true }]}>
          <Select options={MODEL_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={
            isEdit || !apiKeyRequired
              ? []
              : [{ required: true, message: '请输入 API Key' }]
          }
        >
          <Input.Password
            maxLength={MODEL_API_KEY_MAX_LENGTH}
            autoComplete="new-password"
            placeholder={
              isEdit
                ? '留空表示不修改'
                : apiKeyRequired
                  ? '请输入 API Key'
                  : 'Ollama 可留空'
            }
          />
        </Form.Item>
        <Form.Item
          name="baseUrl"
          label="API Base URL"
          rules={[
            {
              required: true,
              whitespace: true,
              message: '请输入 API Base URL',
            },
            { type: 'url', message: '请输入合法的 http/https 地址' },
          ]}
        >
          <Input
            maxLength={MODEL_BASE_URL_MAX_LENGTH}
            placeholder={`如 ${VENDOR_DEFAULT_BASE_URL[vendor]}`}
          />
        </Form.Item>
        {showProtocol ? (
          <Form.Item name="protocol" label="API 协议">
            <Segmented options={PROTOCOL_OPTIONS} block />
          </Form.Item>
        ) : null}
        <Form.Item
          name="contextLength"
          label="模型上下文长度（token）"
          rules={[{ required: true, message: '请输入上下文长度' }]}
        >
          <InputNumber
            min={MODEL_CONTEXT_LENGTH_MIN}
            max={MODEL_CONTEXT_LENGTH_MAX}
            className="w-full"
            placeholder="如 128000"
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
};
