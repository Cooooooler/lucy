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
});
