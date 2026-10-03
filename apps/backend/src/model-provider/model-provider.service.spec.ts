import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLogger } from '../common/app-logger.service.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
import {
  MODEL_ID,
  MODEL_ITEM_KEYS,
  makeModelItem,
  makeModelProvider,
  makeModelQb,
  modelAliasStub,
} from '../test/model-provider.fixtures.js';
import { ApiKeyCipher } from './api-key-cipher.service.js';
import {
  ModelProvider,
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from './entities/model-provider.entity.js';
import { ModelProviderService } from './model-provider.service.js';

const SECRET = 'test-model-provider-secret-32-chars-long';
const config = { getOrThrow: () => SECRET } as unknown as ConfigService;

describe('ModelProviderService', () => {
  const repo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLogger;
  let cipher: ApiKeyCipher;
  let service: ModelProviderService;

  const buildService = async (): Promise<ModelProviderService> => {
    const moduleRef = await Test.createTestingModule({
      // KeysetPaginator 走与生产一致的模块路径（验证 PaginationModule 真的导出它）
      imports: [PaginationModule],
      providers: [
        ModelProviderService,
        { provide: AppLogger, useValue: logger },
        { provide: getRepositoryToken(ModelProvider), useValue: repo },
        { provide: ApiKeyCipher, useValue: cipher },
      ],
    }).compile();
    return moduleRef.get(ModelProviderService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    cipher = new ApiKeyCipher(config);
    // save 回显入参（模拟落库返回），便于断言加解密后的字段
    repo.save.mockImplementation((entity: Partial<ModelProvider>) =>
      Promise.resolve({ ...makeModelProvider(), ...entity }),
    );
    repo.createQueryBuilder.mockReturnValue(makeModelQb());
    service = await buildService();
  });

  it('create 加密 API Key 入库并返回不含明文/密文的契约视图', async () => {
    const result = await service.create('u1', {
      name: 'gpt-4o-mini',
      type: ModelProviderType.Llm,
      vendor: ModelProviderVendor.OpenAI,
      baseUrl: 'https://api.openai.com/v1',
      contextLength: 128000,
      apiKey: 'sk-plain-key-abcd',
    });

    const saved = repo.save.mock.calls[0]?.[0] as ModelProvider;
    expect(saved.ownerId).toBe('u1');
    expect(saved.vendor).toBe(ModelProviderVendor.OpenAI);
    expect(saved.protocol).toBe(ModelProviderProtocol.ChatCompletions);
    expect(saved.apiKeyEncrypted).not.toContain('sk-plain-key-abcd');
    expect(cipher.decrypt(saved.apiKeyEncrypted)).toBe('sk-plain-key-abcd');
    expect(saved.apiKeyLast4).toBe('abcd');

    expect(result).toEqual(makeModelItem());
    // 明文与密文都不得出现在响应里
    expect(JSON.stringify(result)).not.toContain('sk-plain-key-abcd');
    expect(result).not.toHaveProperty('apiKeyEncrypted');
    expect(result).not.toHaveProperty('apiKey');
  });

  it('create 显式协议被尊重', async () => {
    await service.create('u1', {
      name: 'm',
      type: ModelProviderType.Llm,
      vendor: ModelProviderVendor.OpenAI,
      baseUrl: 'https://x/v1',
      protocol: ModelProviderProtocol.Responses,
      contextLength: 1,
      apiKey: 'k',
    });
    expect(repo.save.mock.calls[0]?.[0]).toMatchObject({
      protocol: ModelProviderProtocol.Responses,
    });
  });

  it('create ollama 省略 apiKey：存空串而非密文', async () => {
    await service.create('u1', {
      name: 'qwen2.5:7b',
      type: ModelProviderType.Llm,
      vendor: ModelProviderVendor.Ollama,
      baseUrl: 'http://localhost:11434',
      contextLength: 32768,
    });
    expect(repo.save.mock.calls[0]?.[0]).toMatchObject({
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
      apiKeyLast4: '',
    });
  });

  it('create 非 ollama 缺少 apiKey → 400', async () => {
    await expect(
      service.create('u1', {
        name: 'claude',
        type: ModelProviderType.Llm,
        vendor: ModelProviderVendor.Anthropic,
        baseUrl: 'https://api.anthropic.com',
        contextLength: 200000,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create 拒绝链路本地/云元数据主机（外呼出口策略）', async () => {
    await expect(
      service.create('u1', {
        name: 'meta',
        type: ModelProviderType.Llm,
        vendor: ModelProviderVendor.OpenAI,
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        contextLength: 1,
        apiKey: 'k',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('update 拒绝把 baseUrl 改到链路本地', async () => {
    repo.findOne.mockResolvedValue(makeModelProvider());
    await expect(
      service.update('u1', MODEL_ID, { baseUrl: 'http://169.254.169.254/' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('update 换到需要 Key 的供应商却无 Key → 400', async () => {
    const existing = makeModelProvider({
      vendor: ModelProviderVendor.Ollama,
      apiKeyEncrypted: '',
      apiKeyLast4: '',
    });
    repo.findOne.mockResolvedValue(existing);

    await expect(
      service.update('u1', MODEL_ID, { vendor: ModelProviderVendor.OpenAI }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('list 按属主过滤，并透传类型/名称条件', async () => {
    const qb = makeModelQb();
    repo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.list('u1', {
      type: ModelProviderType.Llm,
      name: 'gpt',
    });

    expect(qb.where).toHaveBeenCalledWith('m.ownerId = :uid', { uid: 'u1' });
    expect(qb.andWhere).toHaveBeenCalledWith('m.type = :type', {
      type: ModelProviderType.Llm,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('m.name ILIKE :name', {
      name: '%gpt%',
    });
    expect(result.list).toEqual([makeModelItem()]);
    expect(result.nextCursor).toBeNull();
  });

  it('list 无过滤条件时不追加 where', async () => {
    const qb = makeModelQb();
    repo.createQueryBuilder.mockReturnValue(qb);
    await service.list('u1', {});
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('list 做列投影，把 api_key_encrypted 挡在 SELECT 之外', async () => {
    const qb = makeModelQb();
    repo.createQueryBuilder.mockReturnValue(qb);
    await service.list('u1', {});

    const selected = qb.select.mock.calls[0]?.[0] as string[];
    expect(selected).toContain('m.apiKeyLast4');
    expect(selected).not.toContain('m.apiKeyEncrypted');
  });

  it('list 转义 name 里的 ILIKE 通配符（% / _ 不当通配符）', async () => {
    const qb = makeModelQb();
    repo.createQueryBuilder.mockReturnValue(qb);
    await service.list('u1', { name: '50%_off' });

    expect(qb.andWhere).toHaveBeenCalledWith('m.name ILIKE :name', {
      name: '%50\\%\\_off%',
    });
  });

  it('get 属主返回契约视图', async () => {
    repo.findOne.mockResolvedValue(makeModelProvider());
    await expect(service.get('u1', MODEL_ID)).resolves.toEqual(makeModelItem());
  });

  it('get 不存在或非属主统一 404', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.get('u2', MODEL_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: MODEL_ID, ownerId: 'u2' },
    });
  });

  it('update 只改显式字段，省略 apiKey 时保留原密文', async () => {
    const existing = makeModelProvider();
    repo.findOne.mockResolvedValue(existing);

    await service.update('u1', MODEL_ID, { name: 'new-name' });

    expect(existing.name).toBe('new-name');
    expect(existing.apiKeyEncrypted).toBe('aXY.aXY.aXY');
    expect(existing.apiKeyLast4).toBe('abcd');
    expect(existing.type).toBe(ModelProviderType.Llm);
  });

  it('update 传入 apiKey 时重新加密并刷新尾号', async () => {
    const existing = makeModelProvider();
    repo.findOne.mockResolvedValue(existing);

    await service.update('u1', MODEL_ID, { apiKey: 'sk-new-key-9999' });

    expect(existing.apiKeyLast4).toBe('9999');
    expect(cipher.decrypt(existing.apiKeyEncrypted)).toBe('sk-new-key-9999');
  });

  it('update 不存在或非属主 404', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.update('u2', MODEL_ID, { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('remove 按属主删除；未命中 404', async () => {
    repo.delete.mockResolvedValueOnce({ affected: 1 });
    await expect(service.remove('u1', MODEL_ID)).resolves.toBeNull();
    expect(repo.delete).toHaveBeenCalledWith({ id: MODEL_ID, ownerId: 'u1' });

    repo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.remove('u1', MODEL_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create/get/list 字段集一致', async () => {
    repo.findOne.mockResolvedValue(makeModelProvider());
    const detail = await service.get('u1', MODEL_ID);
    const listed = await service.list('u1', {});
    for (const item of [detail, listed.list[0]]) {
      expect(Object.keys(item).sort((a, b) => a.localeCompare(b))).toEqual(
        MODEL_ITEM_KEYS,
      );
    }
  });

  it('别名解析兜底存在（列表分页依赖实体元数据）', () => {
    expect(
      modelAliasStub('m').metadata.findColumnWithPropertyName('id'),
    ).toEqual({ databaseName: 'id' });
  });
});
