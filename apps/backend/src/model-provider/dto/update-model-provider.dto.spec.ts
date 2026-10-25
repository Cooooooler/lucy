import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe.js';
import {
  ModelProviderType,
  ModelProviderVendor,
} from '../entities/model-provider.entity.js';
import { CreateModelProviderDto } from './create-model-provider.dto.js';
import { UpdateModelProviderDto } from './update-model-provider.dto.js';

const BASE_CREATE = {
  name: 'qwen',
  type: ModelProviderType.Llm,
  vendor: ModelProviderVendor.Ollama,
  baseUrl: 'http://localhost:11434',
  contextLength: 32768,
};

/**
 * 经真实全局管道（与 `CommonModule` 的 `APP_PIPE` 同一份配置）驱动，而不是只断言装饰器元数据。
 *
 * 钉住 PATCH 的 null 语义：省略 = 不修改该字段；显式 `null` 必须 400——默认 PartialType 的
 * `@IsOptional()` 会放行 `null`，穿透到服务层后 `name/… = null` 撞 NOT NULL 列（23502）、
 * `apiKey.trim()` 直接 TypeError，两者都被兜成 500（issue #92 的根因）。
 */
describe('模型供应商 DTO 经全局 ValidationPipe', () => {
  const pipe = createValidationPipe();

  const create = (value: unknown): Promise<CreateModelProviderDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: CreateModelProviderDto,
    }) as Promise<CreateModelProviderDto>;

  const update = (value: unknown): Promise<UpdateModelProviderDto> =>
    pipe.transform(value, {
      type: 'body',
      metatype: UpdateModelProviderDto,
    }) as Promise<UpdateModelProviderDto>;

  it('创建：基线载荷合法（说明下面 PATCH 用例的字段本身没问题）', async () => {
    await expect(create(BASE_CREATE)).resolves.toBeInstanceOf(
      CreateModelProviderDto,
    );
  });

  it('更新：合法值仍可经 PartialType 校验通过', async () => {
    const dto = await update({ ...BASE_CREATE, name: '  qwen2  ' });
    expect(dto).toBeInstanceOf(UpdateModelProviderDto);
    expect(dto.name?.trim()).toBe('qwen2');
    expect(dto.type).toBe(ModelProviderType.Llm);
    expect(dto.apiKey).toBeUndefined();
  });

  it('更新：省略字段不校验（不修改语义）', async () => {
    await expect(update({ name: 'x' })).resolves.toBeInstanceOf(
      UpdateModelProviderDto,
    );
  });

  it('更新：显式 null 被 400（默认 @IsOptional 会放行 null 并撞上 NOT NULL / trim TypeError）', async () => {
    for (const [field] of Object.entries(BASE_CREATE)) {
      await expect(update({ name: 'keep', [field]: null })).rejects.toThrow();
    }
    await expect(update({ apiKey: null })).rejects.toThrow();
    await expect(update({ protocol: null })).rejects.toThrow();
  });

  it('更新：空串与纯空白串被 400（留空必须表现为不发送该字段）', async () => {
    await expect(update({ name: '' })).rejects.toThrow();
    await expect(update({ name: '   ' })).rejects.toThrow();
    await expect(update({ apiKey: '' })).rejects.toThrow();
  });
});
