import { vi, type Mock } from 'vitest';
import {
  ModelProvider,
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from '../model-provider/entities/model-provider.entity.js';
import { aliasStub, chainable } from './support/query-builder.js';

/**
 * model-provider 模块测试的共享夹具（本目录 `src/test/**` 不计入覆盖率门禁）。
 */

/** 实体主键是 uuid 列：游标里的 id 必须是合法 UUID，否则解码即 400 */
export const MODEL_ID = '3d8e6c4a-5f70-4912-8abc-d4e5f6071829';
export const OTHER_MODEL_ID = '4e9f7d5b-6081-4a23-9bcd-e5f607182930';

export const EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** 一段可直接入库的假密文（形状与 ApiKeyCipher.encrypt 一致） */
export const FAKE_CIPHER = 'aXY.aXY.aXY';

export const makeModelProvider = (
  over: Partial<ModelProvider> = {},
): ModelProvider => ({
  id: MODEL_ID,
  ownerId: 'u1',
  name: 'gpt-4o-mini',
  type: ModelProviderType.Llm,
  vendor: ModelProviderVendor.OpenAI,
  baseUrl: 'https://api.openai.com/v1',
  protocol: ModelProviderProtocol.ChatCompletions,
  contextLength: 128000,
  apiKeyEncrypted: FAKE_CIPHER,
  apiKeyLast4: 'abcd',
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...over,
});

/** 模型对外契约视图（ModelProviderItemDto）的字段集（已按字典序预排好） */
export const MODEL_ITEM_KEYS = [
  'apiKeyMasked',
  'baseUrl',
  'contextLength',
  'createdAt',
  'id',
  'name',
  'ownerId',
  'protocol',
  'type',
  'updatedAt',
  'vendor',
];

export type ModelItem = {
  id: string;
  ownerId: string;
  name: string;
  type: ModelProviderType;
  vendor: ModelProviderVendor;
  baseUrl: string;
  protocol: ModelProviderProtocol;
  contextLength: number;
  apiKeyMasked: string;
  createdAt: Date;
  updatedAt: Date;
};

export const makeModelItem = (over: Partial<ModelItem> = {}): ModelItem => ({
  id: MODEL_ID,
  ownerId: 'u1',
  name: 'gpt-4o-mini',
  type: ModelProviderType.Llm,
  vendor: ModelProviderVendor.OpenAI,
  baseUrl: 'https://api.openai.com/v1',
  protocol: ModelProviderProtocol.ChatCompletions,
  contextLength: 128000,
  apiKeyMasked: '••••••abcd',
  createdAt: EPOCH,
  updatedAt: EPOCH,
  ...over,
});

/** 与 knowledge 夹具共用同一份主别名 stub（见 support/query-builder.ts） */
export const modelAliasStub = aliasStub;

type ModelQb = {
  expressionMap: { mainAlias: ReturnType<typeof modelAliasStub> };
  select: Mock;
  where: Mock;
  andWhere: Mock;
  orderBy: Mock;
  addOrderBy: Mock;
  take: Mock;
  getMany: Mock;
};

/** 可链式 QueryBuilder mock：供模型列表用 */
export const makeModelQb = (
  rows: ModelProvider[] = [makeModelProvider()],
): ModelQb => {
  const qb = chainable(
    {
      expressionMap: { mainAlias: modelAliasStub('m') },
      select: vi.fn(),
      where: vi.fn(),
      andWhere: vi.fn(),
      orderBy: vi.fn(),
      addOrderBy: vi.fn(),
      take: vi.fn(),
      getMany: vi.fn(),
    },
    ['select', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'take'],
  );
  qb.getMany.mockResolvedValue(rows);
  return qb;
};
