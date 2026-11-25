import type { ModelProvider } from '@/api/types';

/** 测试用模型数据工厂 */
export function makeModel(
  id: string,
  name: string,
  overrides: Partial<ModelProvider> = {},
): ModelProvider {
  return {
    id,
    ownerId: 'u1',
    name,
    type: 'llm',
    vendor: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chat-completions',
    contextLength: 128000,
    apiKeyMasked: '••••••abcd',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** 基础卡片测试数据 */
export const baseModel: ModelProvider = makeModel('m1', 'gpt-4o-mini');
