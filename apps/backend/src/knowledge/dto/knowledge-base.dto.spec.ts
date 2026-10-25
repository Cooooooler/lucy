import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe.js';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto.js';
import { UpdateKnowledgeBaseDto } from './update-knowledge-base.dto.js';

/**
 * 经真实全局管道（`createValidationPipe` 与 `CommonModule` 的 `APP_PIPE` 同一份配置）
 * 驱动，而不是只断言装饰器元数据。
 *
 * 钉住的是「描述非空」这条不变式在**三层**口径一致：列非空（迁移把 NULL/空串一并回填）、
 * DTO 拒绝空串/纯空白、前端表单 whitespace 校验。同时钉住 PATCH 的 null 语义：
 * 省略=不改，显式 null 必须 400（而不是穿透到服务层撞 NOT NULL 约束变 500）。
 */
describe('知识库 DTO 经全局 ValidationPipe', () => {
  const pipe = createValidationPipe();

  const create = (value: unknown): Promise<CreateKnowledgeBaseDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreateKnowledgeBaseDto,
    }) as Promise<CreateKnowledgeBaseDto>;

  const update = (value: unknown): Promise<UpdateKnowledgeBaseDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: UpdateKnowledgeBaseDto,
    }) as Promise<UpdateKnowledgeBaseDto>;

  it('创建：缺少 description 被 400（现为必填）', async () => {
    await expect(create({ name: 'x' })).rejects.toThrow();
  });

  it('创建：空串与纯空白串均被 400（与列非空、前端 whitespace 校验一致）', async () => {
    await expect(create({ name: 'x', description: '' })).rejects.toThrow();
    await expect(create({ name: 'x', description: '   ' })).rejects.toThrow();
  });

  it('创建：description 首尾空白被 trim', async () => {
    const dto = await create({ name: 'x', description: '  产品文档  ' });
    expect(dto.description).toBe('产品文档');
  });

  it('创建：description 边界值（1 与 200 字符）合法', async () => {
    await expect(
      create({ name: 'x', description: 'd' }),
    ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
    await expect(
      create({ name: 'x', description: 'd'.repeat(200) }),
    ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
    await expect(
      create({ name: 'x', description: 'd'.repeat(201) }),
    ).rejects.toThrow();
  });

  it('创建：省略 visibility 取默认（不校验），显式 null 被 400', async () => {
    await expect(
      create({ name: 'x', description: 'd' }),
    ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
    await expect(
      create({ name: 'x', description: 'd', visibility: null }),
    ).rejects.toThrow();
  });

  it('更新：省略 description 合法（不修改）', async () => {
    const dto = await update({ name: 'x' });
    expect(dto.description).toBeUndefined();
  });

  it('更新：显式 null 被 400（默认 PartialType 的 @IsOptional 会放行 null 并撞上 NOT NULL）', async () => {
    await expect(update({ description: null })).rejects.toThrow();
    await expect(update({ name: null })).rejects.toThrow();
    await expect(update({ visibility: null })).rejects.toThrow();
  });

  it('更新：空串与纯空白串被 400', async () => {
    await expect(update({ description: '' })).rejects.toThrow();
    await expect(update({ description: '   ' })).rejects.toThrow();
  });

  it('更新：description 首尾空白被 trim', async () => {
    const dto = await update({ description: '  产品文档  ' });
    expect(dto.description).toBe('产品文档');
  });

  it('创建：完整检索设置合法（三种模式 / 边界值）', async () => {
    const rerankModelId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    for (const retrievalMode of ['fulltext', 'vector', 'hybrid'] as const) {
      await expect(
        create({
          name: 'x',
          description: 'd',
          retrievalMode,
          topK: 10,
          scoreThresholdEnabled: true,
          scoreThreshold: 0.35,
          semanticWeight: 70,
          rerankModelId,
        }),
      ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
    }
    await expect(
      create({
        name: 'x',
        description: 'd',
        topK: 1,
        scoreThreshold: 0,
        semanticWeight: 0,
        scoreThresholdEnabled: false,
        rerankModelId: null,
      }),
    ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
  });

  it('创建：省略检索设置合法（服务层落默认值）', async () => {
    const dto = await create({ name: 'x', description: 'd' });
    expect(dto.retrievalMode).toBeUndefined();
    expect(dto.topK).toBeUndefined();
    expect(dto.scoreThresholdEnabled).toBeUndefined();
    expect(dto.scoreThreshold).toBeUndefined();
    expect(dto.semanticWeight).toBeUndefined();
    expect(dto.rerankModelId).toBeUndefined();
  });

  it('创建：非法检索模式 / 越界数值被 400', async () => {
    const base = { name: 'x', description: 'd' };
    await expect(
      create({ ...base, retrievalMode: 'keyword' }),
    ).rejects.toThrow();
    for (const topK of [0, 11, 2.5]) {
      await expect(create({ ...base, topK })).rejects.toThrow();
    }
    for (const scoreThreshold of [-0.1, 1.1, '0.5']) {
      await expect(create({ ...base, scoreThreshold })).rejects.toThrow();
    }
    for (const semanticWeight of [-1, 101, 50.5]) {
      await expect(create({ ...base, semanticWeight })).rejects.toThrow();
    }
    await expect(
      create({ ...base, scoreThresholdEnabled: 'yes' }),
    ).rejects.toThrow();
  });

  it('创建：rerankModelId 允许 null（不重排），非 UUID 被 400', async () => {
    await expect(
      create({ name: 'x', description: 'd', rerankModelId: null }),
    ).resolves.toBeInstanceOf(CreateKnowledgeBaseDto);
    await expect(
      create({ name: 'x', description: 'd', rerankModelId: 'not-a-uuid' }),
    ).rejects.toThrow();
  });

  it('更新：检索设置不可修改（不在更新白名单，400 而非静默忽略）', async () => {
    // 「仅创建时设置」靠 Update DTO 不声明这些字段 + 全局 forbidNonWhitelisted 实现；
    // 若有人把更新 DTO 改回继承 CreateKnowledgeBaseDto，这条会红
    for (const patch of [
      { retrievalMode: 'hybrid' },
      { topK: 10 },
      { scoreThresholdEnabled: true },
      { scoreThreshold: 0.5 },
      { semanticWeight: 70 },
      { rerankModelId: null },
    ]) {
      await expect(update(patch)).rejects.toThrow();
    }
  });
});
