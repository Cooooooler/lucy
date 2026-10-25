import { errorMessageOf } from '@/api/client';
import type {
  KnowledgeBase,
  KnowledgeBaseVisibility,
  KnowledgeRetrievalMode,
} from '@/api/types';
import {
  useCreateKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import { useModelProvidersByType } from '@/hooks/use-model-provider';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
  KNOWLEDGE_SCORE_THRESHOLD_DEFAULT,
  KNOWLEDGE_SCORE_THRESHOLD_MAX,
  KNOWLEDGE_SCORE_THRESHOLD_MIN,
  KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT,
  KNOWLEDGE_SEMANTIC_WEIGHT_MAX,
  KNOWLEDGE_SEMANTIC_WEIGHT_MIN,
  KNOWLEDGE_TOP_K_DEFAULT,
  KNOWLEDGE_TOP_K_MAX,
  KNOWLEDGE_TOP_K_MIN,
} from '@lucy/shared';
import {
  App,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Slider,
  Switch,
  Tooltip,
} from 'antd';
import type { FC } from 'react';
import { RETRIEVAL_MODE_OPTIONS } from './knowledge-labels';

/** 表单抽屉的可见性选项（不含"全部"，默认 private） */
const FORM_VISIBILITY_OPTIONS: {
  label: string;
  value: KnowledgeBaseVisibility;
}[] = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

/** 表单值：创建态含检索设置，编辑态只渲染内容字段（`preserve={false}` 随之丢弃） */
type KnowledgeFormValues = {
  name: string;
  description: string;
  visibility: KnowledgeBaseVisibility;
  retrievalMode: KnowledgeRetrievalMode;
  topK: number;
  scoreThresholdEnabled: boolean;
  scoreThreshold: number;
  semanticWeight: number;
  /** 仅前端：控制是否启用重排（关闭时不提交 rerankModelId） */
  rerankEnabled: boolean;
  rerankModelId?: string | null;
};

/** 标题/字段旁的问号图标：悬停显示 Tooltip 说明（统一替代 ant-form-item-extra） */
const HelpIcon: FC<{ help: string; label: string }> = ({ help, label }) => (
  <Tooltip title={help}>
    <QuestionCircleOutlined
      aria-label={label}
      className="cursor-help text-gray-400"
    />
  </Tooltip>
);

/**
 * 数值 + 拖动条控件（召回条数、Score 阈值、权重共用）：两者是同一个受控值。
 *
 * Form.Item 注入 `value`/`onChange`/`id`，输入框与拖动条任一改动都写回同一个 store，
 * 因此始终同步。`hidden` 用于「未启用 Score 阈值」：隐藏但保持挂载，关闭再打开时保留上次的值。
 */
const NumberSliderControl: FC<{
  id?: string;
  value?: number;
  onChange?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  /** 控件名：同时作为拖动条的 aria-label（同页有多个滑块时用于区分） */
  label: string;
  hidden?: boolean;
  disabled?: boolean;
}> = ({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  label,
  hidden = false,
  disabled = false,
}) => (
  <div
    className="flex items-center gap-3"
    style={{ display: hidden ? 'none' : undefined }}
  >
    <InputNumber
      id={id}
      min={min}
      max={max}
      step={step}
      precision={precision}
      value={value}
      disabled={disabled}
      // 清空时回落到下界，避免 null 穿透到表单/接口
      onChange={(next) => onChange?.(next ?? min)}
      className="w-24 shrink-0"
    />
    <Slider
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(next) => onChange?.(next)}
      ariaLabelForHandle={label}
      className="min-w-0 flex-1"
    />
  </div>
);

/**
 * 检索设置字段：创建态可编辑，编辑态**只读展示**（全部控件 disabled）。
 *
 * 单独抽成组件是为了把 `useModelProvidersByType` 的请求挂在「抽屉真正打开」之后：
 * Drawer 的 `destroyOnHidden` 会在关闭时卸载子树，列表页常驻挂载抽屉时不会白拉一次模型列表。
 */
const RetrievalSettingsFields: FC<{
  kb?: KnowledgeBase;
  disabled: boolean;
}> = ({ kb, disabled }) => {
  const form = Form.useFormInstance<KnowledgeFormValues>();
  const retrievalMode = Form.useWatch('retrievalMode', form);
  const scoreThresholdEnabled = Form.useWatch('scoreThresholdEnabled', form);
  const rerankEnabled = Form.useWatch('rerankEnabled', form);
  // 重排模型按类型取（模型管理里 type=rerank 的配置），未配置时下拉为空 = 不重排。
  // 只在开关打开（或编辑态确有引用）时才请求；下拉已接 loading，打开瞬间自然有加载态。
  const { models, isLoading } = useModelProvidersByType(
    'rerank',
    rerankEnabled === true || Boolean(kb?.rerankModelId),
  );
  // 语义权重：编辑态字段的 initialValue 不会触发 useWatch 重渲染，回落到知识库当前值；
  // 关键词权重是派生值（后端只存 semanticWeight），两者互补、合计 100%
  const semanticWeight =
    Form.useWatch('semanticWeight', form) ??
    kb?.semanticWeight ??
    KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT;
  const keywordWeight = KNOWLEDGE_SEMANTIC_WEIGHT_MAX - semanticWeight;

  return (
    <>
      <Form.Item name="retrievalMode" label="检索模式">
        <Segmented options={RETRIEVAL_MODE_OPTIONS} block disabled={disabled} />
      </Form.Item>
      <Form.Item
        name="rerankModelId"
        // 关闭时下拉隐藏；控制区的 32px 最小高度由该 class 收起，避免留下一块空白
        className={rerankEnabled ? undefined : 'form-item-control-collapsed'}
        // 隐藏的字段仍参与校验，required 需随开关变化
        rules={[{ required: rerankEnabled, message: '请选择重排模型' }]}
        label={
          <span className="inline-flex items-center gap-2">
            重排模型
            {/* 与 Score 开关同理：必须注册进 Form，useWatch 才能读到 */}
            <Form.Item name="rerankEnabled" valuePropName="checked" noStyle>
              <Switch
                size="small"
                aria-label="启用重排模型"
                disabled={disabled}
              />
            </Form.Item>
          </span>
        }
      >
        <Select
          allowClear
          disabled={disabled}
          loading={isLoading}
          placeholder="请选择重排模型"
          // 隐藏但保持挂载：关闭再打开时保留上次选择
          style={{ display: rerankEnabled ? undefined : 'none' }}
          options={models.map((model) => ({
            label: model.name,
            value: model.id,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="topK"
        label="召回条数（TopK）"
        rules={[{ required: true, message: '请输入召回条数' }]}
      >
        <NumberSliderControl
          min={KNOWLEDGE_TOP_K_MIN}
          max={KNOWLEDGE_TOP_K_MAX}
          precision={0}
          label="召回条数（TopK）"
          disabled={disabled}
        />
      </Form.Item>
      <Form.Item
        name="scoreThreshold"
        initialValue={kb?.scoreThreshold ?? KNOWLEDGE_SCORE_THRESHOLD_DEFAULT}
        rules={[
          {
            // 启用阈值却为 0 等于不过滤；检索设置创建后不可改，提交前必须拦下
            validator: (_rule, value: number | null | undefined) =>
              !scoreThresholdEnabled ||
              (typeof value === 'number' &&
                value > KNOWLEDGE_SCORE_THRESHOLD_MIN)
                ? Promise.resolve()
                : Promise.reject(new Error('启用阈值时需大于 0')),
          },
        ]}
        // 未启用时控件被隐藏，同样收起控制区最小高度
        className={
          scoreThresholdEnabled ? undefined : 'form-item-control-collapsed'
        }
        label={
          <span className="inline-flex items-center gap-2">
            Score 阈值
            {/* 必须是注册进 Form 的字段：useWatch 只从「已注册字段」的取值里读，
                用 setFieldValue 写未注册的键不会触发重渲染（开关会点不动） */}
            <Form.Item
              name="scoreThresholdEnabled"
              valuePropName="checked"
              noStyle
            >
              <Switch
                size="small"
                aria-label="启用 Score 阈值"
                disabled={disabled}
              />
            </Form.Item>
          </span>
        }
      >
        <NumberSliderControl
          min={KNOWLEDGE_SCORE_THRESHOLD_MIN}
          max={KNOWLEDGE_SCORE_THRESHOLD_MAX}
          step={0.01}
          precision={2}
          label="Score 阈值"
          hidden={!scoreThresholdEnabled}
          disabled={disabled}
        />
      </Form.Item>
      {retrievalMode === 'hybrid' ? (
        // 语义在左、关键词在右；两者此消彼长（合计 100%），拖动任一侧另一侧反向跟随
        <div className="flex gap-4">
          <Form.Item
            name="semanticWeight"
            className="flex-1"
            label={
              <span className="inline-flex items-center gap-1">
                语义权重（%）
                <HelpIcon
                  help="语义召回结果的权重。与关键词权重此消彼长，合计 100%。"
                  label="语义权重说明"
                />
              </span>
            }
            // 条件渲染 + preserve={false}：字段切走后值会被丢弃，重新挂载时靠 initialValue 复位
            // （因此它不在表单级 initialValues 里，避免 antd 报「无法覆盖已有 initialValues」）
            initialValue={
              kb?.semanticWeight ?? KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT
            }
            rules={[{ required: true, message: '请输入语义权重' }]}
          >
            <NumberSliderControl
              min={KNOWLEDGE_SEMANTIC_WEIGHT_MIN}
              max={KNOWLEDGE_SEMANTIC_WEIGHT_MAX}
              precision={0}
              label="语义权重（%）"
              disabled={disabled}
            />
          </Form.Item>
          <Form.Item
            className="flex-1"
            htmlFor="keywordWeight"
            label={
              <span className="inline-flex items-center gap-1">
                关键词权重（%）
                <HelpIcon
                  help="关键词召回结果的权重。与语义权重此消彼长，合计 100%。"
                  label="关键词权重说明"
                />
              </span>
            }
          >
            <NumberSliderControl
              id="keywordWeight"
              min={KNOWLEDGE_SEMANTIC_WEIGHT_MIN}
              max={KNOWLEDGE_SEMANTIC_WEIGHT_MAX}
              precision={0}
              label="关键词权重（%）"
              value={keywordWeight}
              disabled={disabled}
              onChange={(value) =>
                form.setFieldValue(
                  'semanticWeight',
                  KNOWLEDGE_SEMANTIC_WEIGHT_MAX - value,
                )
              }
            />
          </Form.Item>
        </div>
      ) : null}
    </>
  );
};

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
 *
 * 检索设置只在创建时确定：编辑态**可见但只读**（控件全部 disabled），
 * 更新接口也不接受这些字段（提交时只带 name/description/visibility）。
 */
export const KnowledgeFormDrawer: FC<KnowledgeFormDrawerProps> = ({
  open,
  mode,
  kb,
  onClose,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<KnowledgeFormValues>();
  // 两个 mutation 无条件调用，保证 hooks 顺序稳定；按 mode 选用
  const createMutation = useCreateKnowledgeBase();
  const updateMutation = useUpdateKnowledgeBase();
  const isEdit = mode === 'edit';

  const initialValues: Partial<KnowledgeFormValues> = {
    name: kb?.name ?? '',
    description: kb?.description ?? undefined,
    visibility: kb?.visibility ?? 'private',
    // 检索设置：创建态取默认值，编辑态回填当前知识库（只读展示）
    retrievalMode: kb?.retrievalMode ?? 'fulltext',
    topK: kb?.topK ?? KNOWLEDGE_TOP_K_DEFAULT,
    scoreThresholdEnabled: kb?.scoreThresholdEnabled ?? false,
    rerankEnabled: kb ? kb.rerankModelId !== null : false,
    rerankModelId: kb?.rerankModelId ?? null,
  };

  const handleSubmit = async () => {
    let values: KnowledgeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      // 校验未通过：表单自身会展示错误提示，无需额外处理
      return;
    }
    const input = {
      name: values.name.trim(),
      description: values.description.trim(),
      visibility: values.visibility,
    };
    try {
      if (isEdit && kb) {
        await updateMutation.mutateAsync({ id: kb.id, input });
      } else {
        await createMutation.mutateAsync({
          ...input,
          retrievalMode: values.retrievalMode ?? 'fulltext',
          topK: values.topK ?? KNOWLEDGE_TOP_K_DEFAULT,
          scoreThresholdEnabled: values.scoreThresholdEnabled ?? false,
          scoreThreshold:
            values.scoreThreshold ?? KNOWLEDGE_SCORE_THRESHOLD_DEFAULT,
          semanticWeight:
            values.semanticWeight ?? KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT,
          // 开关关闭时即使之前选过模型也不重排
          rerankModelId: values.rerankEnabled
            ? (values.rerankModelId ?? null)
            : null,
        });
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
        initialValues={initialValues}
      >
        <div className="mb-4 text-base font-semibold">基础设置</div>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, whitespace: true, message: '请输入知识库名称' },
          ]}
        >
          <Input maxLength={20} placeholder="请输入知识库名称" />
        </Form.Item>
        <Form.Item
          name="description"
          label="描述"
          rules={[
            { required: true, whitespace: true, message: '请输入知识库描述' },
          ]}
        >
          <Input.TextArea
            maxLength={200}
            showCount
            rows={4}
            placeholder="请输入知识库描述"
          />
        </Form.Item>
        <Form.Item name="visibility" label="可见性">
          <Segmented options={FORM_VISIBILITY_OPTIONS} block />
        </Form.Item>
        <Divider />
        <div className="mb-4 flex items-center gap-2">
          <span className="text-base font-semibold">检索设置</span>
          <HelpIcon help="创建后不可修改" label="检索设置说明" />
        </div>
        <RetrievalSettingsFields kb={kb} disabled={isEdit} />
      </Form>
    </Drawer>
  );
};
