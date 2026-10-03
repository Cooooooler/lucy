import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import {
  MODEL_ID,
  makeModelProvider,
} from '../test/model-provider.fixtures.js';
import {
  ModelProvider,
  ModelProviderType,
} from './entities/model-provider.entity.js';
import {
  ModelClientFactory,
  UnsupportedModelTypeError,
} from './model-client.factory.js';
import { ModelConnectionService } from './model-connection.service.js';

describe('ModelConnectionService', () => {
  const repo = { findOne: vi.fn() };
  const factory = {
    buildChat: vi.fn(),
    buildOpenAiChat: vi.fn(),
    buildEmbeddings: vi.fn(),
    assertSupported: vi.fn(),
  };
  // 直接持有 warn 的 mock 引用再断言：`expect(logger.warn)` 会触发 unbound-method
  const loggerWarn = vi.fn();
  const logger = {
    log: vi.fn(),
    warn: loggerWarn,
  } as unknown as AppLogger;
  let timeoutMs = 15000;
  const config = {
    get: (_key: string, def: number) => (timeoutMs === 0 ? def : timeoutMs),
  } as unknown as ConfigService;

  let service: ModelConnectionService;

  const buildService = async (): Promise<ModelConnectionService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelConnectionService,
        { provide: AppLogger, useValue: logger },
        { provide: getRepositoryToken(ModelProvider), useValue: repo },
        { provide: ModelClientFactory, useValue: factory },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    return moduleRef.get(ModelConnectionService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    timeoutMs = 15000;
    // clearAllMocks 只清调用记录、不清实现：显式复位上一条用例可能留下的
    // assertSupported 抛错实现，避免它对后续用例持续生效
    factory.assertSupported.mockImplementation(() => undefined);
    repo.findOne.mockResolvedValue(makeModelProvider());
    service = await buildService();
  });

  it('不支持的类型直接给出结论，不发起调用', async () => {
    repo.findOne.mockResolvedValue(
      makeModelProvider({ type: ModelProviderType.Tts }),
    );
    factory.assertSupported.mockImplementation((type: ModelProviderType) => {
      throw new UnsupportedModelTypeError(type);
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result).toEqual({
      ok: false,
      message: '该模型类型暂不支持连通性测试',
      latencyMs: null,
      detail: null,
    });
    expect(factory.buildChat).not.toHaveBeenCalled();
  });

  it('LLM 连通：返回 ok 与回复片段', async () => {
    factory.buildChat.mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ content: '你好，我是模型' }),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('连接成功');
    expect(result.detail).toBe('回复：你好，我是模型');
    expect(result.latencyMs).toBeTypeOf('number');
  });

  it('Moderation 连通：走 moderateContent', async () => {
    repo.findOne.mockResolvedValue(
      makeModelProvider({ type: ModelProviderType.Moderation }),
    );
    factory.buildOpenAiChat.mockReturnValue({
      moderateContent: vi.fn().mockResolvedValue({ results: [{}, {}] }),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('审核返回 2 条结果');
  });

  it('Text Embedding 连通：返回向量维度', async () => {
    repo.findOne.mockResolvedValue(
      makeModelProvider({ type: ModelProviderType.TextEmbedding }),
    );
    factory.buildEmbeddings.mockReturnValue({
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('向量维度 3');
  });

  it('超时：返回「连接超时」且不泄漏底层细节', async () => {
    timeoutMs = 5;
    factory.buildChat.mockReturnValue({
      invoke: vi.fn(() => new Promise(() => {})),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('连接超时');
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('鉴权失败：401 归一为 API Key 文案', async () => {
    factory.buildChat.mockReturnValue({
      invoke: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Unauthorized'), { status: 401 }),
        ),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('API Key 无效或无权限');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.detail).toBeNull();
  });

  it('网络不可达：归一为「无法连接到 API Base URL」', async () => {
    factory.buildChat.mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error('fetch failed')),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.message).toBe('无法连接到 API Base URL');
  });

  it('其它错误：走通用兜底文案', async () => {
    factory.buildChat.mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await service.test('u1', MODEL_ID);
    expect(result.message).toBe('连接失败，请检查配置');
  });

  it('非属主/不存在：repo 未命中即 404（不构造客户端）', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.test('u2', MODEL_ID)).rejects.toThrow();
    expect(factory.assertSupported).not.toHaveBeenCalled();
  });
});
