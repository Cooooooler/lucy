import type { ModelProvider } from '@/api/types.ts';
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@/components/icons.tsx';
import {
  MODEL_TYPE_COLOR,
  MODEL_TYPE_LABEL,
  PROTOCOL_LABEL,
  VENDOR_COLOR,
  VENDOR_LABEL,
} from '@/components/model-provider/model-provider-labels.ts';

type ModelProviderCardProps = {
  model: ModelProvider;
  /** 各操作只上报意图：mutation 与提示由路由统一持有（见 ModelProviderGrid 的 pendingIds） */
  onEdit?: (model: ModelProvider) => void;
  onDelete: (model: ModelProvider) => void;
  onTest: (model: ModelProvider) => void;
  isUpdatePending: boolean;
  isDeletePending: boolean;
  isTestPending: boolean;
};

/**
 * 模型卡片（纯展示）。
 *
 * 沿用知识库卡片的做法：轻量标记 + antd CSS 变量（`--ant-color-*`），
 * 高度固定 `h-52.5`（210px），与 `@/components/grid-layout` 的 `CARD_ESTIMATED_HEIGHT`
 * 一一对应——改动高度必须同步改常量，否则虚拟化行高与实际不一致会导致滚动位置整体偏移。
 * 操作栏不参与布局（绝对定位于下缘、hover/聚焦滑入），静止态不会多出空白带。
 */
export const ModelProviderCard = ({
  model,
  onEdit,
  onDelete,
  onTest,
  isUpdatePending,
  isDeletePending,
  isTestPending,
}: ModelProviderCardProps) => {
  const isLlm = model.type === 'llm';

  return (
    <div className="group relative flex h-52.5 flex-col overflow-hidden rounded-lg bg-(--ant-color-bg-container) transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-1 hover:ring-(--ant-color-split)">
      {/* 标题固定一行并省略；原生 title 提供全名查看。行高固定是卡片等高的前提 */}
      <div
        className="flex h-11.5 shrink-0 items-center px-4 text-base font-semibold"
        title={model.name}
      >
        <span className="block truncate">{model.name}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex w-fit items-center rounded px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: MODEL_TYPE_COLOR[model.type] }}
          >
            {MODEL_TYPE_LABEL[model.type]}
          </span>
          <span
            className="inline-flex w-fit items-center rounded px-2 py-0.5 text-xs font-medium"
            style={{
              color: VENDOR_COLOR[model.vendor],
              backgroundColor: `${VENDOR_COLOR[model.vendor]}1a`,
            }}
          >
            {VENDOR_LABEL[model.vendor]}
          </span>
        </div>

        <div className="truncate text-sm text-gray-500" title={model.baseUrl}>
          {model.baseUrl}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
          {isLlm ? <span>{PROTOCOL_LABEL[model.protocol]}</span> : null}
          <span>上下文 {model.contextLength.toLocaleString()} tokens</span>
        </div>

        <div className="truncate text-xs text-gray-400" title="API Key（脱敏）">
          {model.apiKeyMasked}
        </div>
      </div>

      {/* 操作栏默认收在卡片下缘之外（由 overflow-hidden 裁掉），hover 或键盘聚焦时才滑入 */}
      <div className="absolute inset-x-0 bottom-0 flex h-11.5 translate-y-full items-center justify-end gap-2 border-t border-(--ant-color-split) bg-(--ant-color-bg-container) px-4 opacity-0 transition duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
        <button
          type="button"
          title="测试连接"
          aria-label="测试连接"
          disabled={isTestPending}
          onClick={() => onTest(model)}
          className="flex h-8 min-w-8 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#4ecdc4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ApiOutlined style={{ color: '#4ecdc4' }} spin={isTestPending} />
        </button>
        <button
          type="button"
          title="编辑模型"
          aria-label="编辑模型"
          disabled={isUpdatePending}
          onClick={() => onEdit?.(model)}
          className="flex h-8 min-w-8 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#45b7d1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <EditOutlined style={{ color: '#45b7d1' }} />
        </button>
        <button
          type="button"
          title="删除模型"
          aria-label="删除模型"
          disabled={isDeletePending}
          onClick={() => onDelete(model)}
          className="flex h-8 min-w-8 cursor-pointer items-center justify-center text-gray-400 transition-colors hover:text-[#ff6b6b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DeleteOutlined style={{ color: '#ff6b6b' }} />
        </button>
      </div>
    </div>
  );
};
