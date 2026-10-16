import type { ModelProvider } from '@/api/types.ts';
import { CardShell } from '@/components/card-list/CardShell.tsx';
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
  /** 各操作只上报意图：mutation 与提示由路由统一持有（见路由的 pendingIds） */
  onEdit?: (model: ModelProvider) => void;
  onDelete: (model: ModelProvider) => void;
  onTest: (model: ModelProvider) => void;
  isUpdatePending: boolean;
  isDeletePending: boolean;
  isTestPending: boolean;
};

/**
 * 模型卡片：外壳由 `@/components/card-list/CardShell` 统一承担（沿用知识库卡片的做法），
 * 这里只填主体与操作按钮。
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
    <CardShell
      title={model.name}
      actions={
        <>
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
        </>
      }
    >
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
    </CardShell>
  );
};
