import type { KnowledgeBase } from '@/api/types';

/** 测试用知识库数据工厂 */
export function makeKb(id: string, name: string): KnowledgeBase {
  return {
    id,
    ownerId: 'u1',
    visibility: 'private',
    name,
    description: `${name} 的描述`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

/** 基础 KnowledgeCard 测试数据 */
export const baseKb: KnowledgeBase = {
  id: 'kb1',
  ownerId: 'u1',
  visibility: 'private' as const,
  name: '产品文档',
  description: '这是一段描述',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};
