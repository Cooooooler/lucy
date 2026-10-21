import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelProviderType } from './entities/model-provider.entity.js';
import { UserDefaultModel } from './entities/user-default-model.entity.js';
import { ModelProviderDefaultsService } from './model-provider-defaults.service.js';

describe('ModelProviderDefaultsService', () => {
  const manager = { find: vi.fn(), delete: vi.fn(), save: vi.fn() };
  const repo = {
    find: vi.fn(),
    manager: { transaction: vi.fn() },
  };
  let service: ModelProviderDefaultsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    repo.manager.transaction.mockImplementation(
      async (fn: (m: typeof manager) => Promise<void>) => fn(manager),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelProviderDefaultsService,
        { provide: getRepositoryToken(UserDefaultModel), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ModelProviderDefaultsService);
  });

  it('list 覆盖全部类型，未设置的返回 null', async () => {
    repo.find.mockResolvedValue([
      {
        modelProviderId: 'm-llm',
        modelProvider: { type: ModelProviderType.Llm },
      },
      {
        modelProviderId: 'm-emb',
        modelProvider: { type: ModelProviderType.TextEmbedding },
      },
    ]);

    const result = await service.list('u1');

    expect(repo.find).toHaveBeenCalledWith({
      select: {
        modelProviderId: true,
        modelProvider: { id: true, type: true },
      },
      where: { ownerId: 'u1' },
      relations: { modelProvider: true },
    });
    expect(result.defaults).toEqual([
      { type: ModelProviderType.Llm, modelProviderId: 'm-llm' },
      { type: ModelProviderType.TextEmbedding, modelProviderId: 'm-emb' },
      { type: ModelProviderType.Speech2Text, modelProviderId: null },
      { type: ModelProviderType.Tts, modelProviderId: null },
      { type: ModelProviderType.Moderation, modelProviderId: null },
    ]);
  });

  it('replace 拒绝不存在或非属主的模型', async () => {
    manager.find.mockResolvedValue([]);

    await expect(
      service.replace('u1', {
        defaults: [{ type: ModelProviderType.Llm, modelProviderId: 'm-other' }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('replace 拒绝类型不匹配的模型', async () => {
    manager.find.mockResolvedValue([{ id: 'm1', type: ModelProviderType.Tts }]);

    await expect(
      service.replace('u1', {
        defaults: [{ type: ModelProviderType.Llm, modelProviderId: 'm1' }],
      }),
    ).rejects.toThrow('默认模型的类型与所设类型不一致');
  });

  it('replace 整体替换：先清空再写入非空项', async () => {
    manager.find.mockResolvedValue([{ id: 'm1', type: ModelProviderType.Llm }]);
    repo.find.mockResolvedValue([
      {
        modelProviderId: 'm1',
        modelProvider: { type: ModelProviderType.Llm },
      },
    ]);

    const result = await service.replace('u1', {
      defaults: [
        { type: ModelProviderType.Llm, modelProviderId: 'm1' },
        { type: ModelProviderType.TextEmbedding, modelProviderId: null },
      ],
    });

    expect(manager.delete).toHaveBeenCalledWith(UserDefaultModel, {
      ownerId: 'u1',
    });
    expect(manager.save).toHaveBeenCalledWith(UserDefaultModel, [
      { ownerId: 'u1', modelProviderId: 'm1' },
    ]);
    expect(result.defaults).toContainEqual({
      type: ModelProviderType.Llm,
      modelProviderId: 'm1',
    });
  });

  it('replace 全部为 null 时只清空、不写库', async () => {
    repo.find.mockResolvedValue([]);

    const result = await service.replace('u1', {
      defaults: [{ type: ModelProviderType.Llm, modelProviderId: null }],
    });

    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.delete).toHaveBeenCalledWith(UserDefaultModel, {
      ownerId: 'u1',
    });
    expect(manager.save).not.toHaveBeenCalled();
    expect(result.defaults.every((item) => item.modelProviderId === null)).toBe(
      true,
    );
  });
});
