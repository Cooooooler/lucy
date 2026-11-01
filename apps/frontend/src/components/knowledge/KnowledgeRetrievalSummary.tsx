import type { KnowledgeRetrievalMode } from '@/api/types';
import { Flex, Tag } from 'antd';
import type { FC } from 'react';
import { RETRIEVAL_MODE_LABEL } from './knowledge-labels';

export type KnowledgeRetrievalSummaryProps = {
  retrievalMode: KnowledgeRetrievalMode;
  topK: number;
  scoreThresholdEnabled: boolean;
  scoreThreshold: number;
  semanticWeight: number;
  /** 重排模型名：由调用方按 `rerankModelId` 解析（未配置重排时为空） */
  rerankModelName?: string;
};

/**
 * 知识库检索设置的只读摘要（详情页页头）。
 *
 * 检索设置只在创建时确定，因此这里只展示、不提供编辑入口。
 */
export const KnowledgeRetrievalSummary: FC<KnowledgeRetrievalSummaryProps> = ({
  retrievalMode,
  topK,
  scoreThresholdEnabled,
  scoreThreshold,
  semanticWeight,
  rerankModelName,
}) => (
  <Flex wrap gap={4}>
    <Tag color="blue">{RETRIEVAL_MODE_LABEL[retrievalMode]}</Tag>
    <Tag>TopK {topK}</Tag>
    <Tag>
      {scoreThresholdEnabled
        ? `Score ≥ ${scoreThreshold.toFixed(2)}`
        : 'Score 关闭'}
    </Tag>
    {retrievalMode === 'hybrid' ? (
      <Tag>
        语义 {semanticWeight}% · 关键词 {100 - semanticWeight}%
      </Tag>
    ) : null}
    {rerankModelName ? <Tag color="purple">重排：{rerankModelName}</Tag> : null}
  </Flex>
);
