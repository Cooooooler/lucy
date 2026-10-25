import type { KnowledgeRetrievalMode } from '@/api/types';

/** 检索模式：与后端 `KnowledgeRetrievalMode` 枚举一一对应（创建表单与详情摘要共用） */
export const RETRIEVAL_MODE_OPTIONS: {
  label: string;
  value: KnowledgeRetrievalMode;
}[] = [
  { label: '全文检索', value: 'fulltext' },
  { label: '向量检索', value: 'vector' },
  { label: '混合检索', value: 'hybrid' },
];

export const RETRIEVAL_MODE_LABEL: Record<KnowledgeRetrievalMode, string> = {
  fulltext: '全文检索',
  vector: '向量检索',
  hybrid: '混合检索',
};
