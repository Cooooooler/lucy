import { BadRequestException } from '@nestjs/common';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../common/validation-pipe.js';
import {
  ModelProviderType,
  ModelProviderVendor,
} from '../entities/model-provider.entity.js';
import { CreateModelProviderDto } from './create-model-provider.dto.js';
import { UpdateModelProviderDto } from './update-model-provider.dto.js';

const pipe = createValidationPipe();

const BASE_CREATE = {
  name: 'qwen',
  type: ModelProviderType.Llm,
  vendor: ModelProviderVendor.Ollama,
  baseUrl: 'http://localhost:11434',
  contextLength: 32768,
};

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

// 全局异常工厂优先报类型类约束（isString/isEnum/isInt...），null 的真实原因（形态错）
// 会以类型文案呈现，而不是注册在前的 min/max/length 误导文案；baseUrl 用 DTO 自带的
// 中文自定义提示。字段与期望文案片段一一对应，语义断言而非仅字段名。
const FAILURE_TEXT: Record<string, string> = {
  name: '名称应为文本',
  type: 'type取值不合法',
  vendor: 'vendor取值不合法',
  baseUrl: 'Base URL',
  contextLength: 'contextLength应为整数',
  apiKey: 'apiKey应为文本',
  protocol: 'protocol取值不合法',
};

/** 断言被全局管道以 BadRequestException（= 路由层 400）拒绝，且失败文案落在指定期望片段上 */
async function expectBadRequestOn(
  dto: typeof CreateModelProviderDto | typeof UpdateModelProviderDto,
  value: unknown,
  expectText: string,
): Promise<void> {
  let caught: unknown;
  try {
    await pipe.transform(value, { type: 'body', metatype: dto });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BadRequestException);
  const body = (caught as BadRequestException).getResponse() as {
    message?: unknown;
  };
  const text = Array.isArray(body.message)
    ? body.message.join('; ')
    : ((body.message as string) ?? '');
  expect(text).toContain(expectText);
}

/**
 * 经真实全局管道（与 `CommonModule` 的 `APP_PIPE` 同一份配置）驱动，而不是只断言装饰器元数据。
 *
 * 钉住 POST 与 PATCH 的 null 语义：省略 = 取默认值（POST）/ 不修改（PATCH）；显式 `null`
 * 必须被 400 拒绝——默认 PartialType 的 `@IsOptional()` 会放行 `null`，穿透到服务层后
 * `name/… = null` 撞 NOT NULL 列（23502）、`apiKey.trim()` 直接 TypeError，两者都被兜成
 * 500（issue #92 的根因）。创建侧一并钉住：基类可选字段改挂 `@ValidateIf` 后显式 null 在
 * POST 上也是 400，防止将来有人把基类改回 `@IsOptional`（其跳过条件会被 PartialType 原样
 * 继承，即便传了 skipNullProperties: false 也照样放行 null）。
 */
describe('模型供应商 DTO 经全局 ValidationPipe', () => {
  it('创建：基线载荷合法（说明下面用例的字段本身没问题）', async () => {
    await expect(create(BASE_CREATE)).resolves.toBeInstanceOf(
      CreateModelProviderDto,
    );
  });

  it('创建：显式 null 的可选字段被 400（@ValidateIf 只放行省略）', async () => {
    await expectBadRequestOn(
      CreateModelProviderDto,
      { ...BASE_CREATE, protocol: null },
      FAILURE_TEXT.protocol,
    );
    await expectBadRequestOn(
      CreateModelProviderDto,
      { ...BASE_CREATE, apiKey: null },
      FAILURE_TEXT.apiKey,
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

  it('更新：显式 null 被各字段自己的校验以 400 拒绝（默认 @IsOptional 会放行 null）', async () => {
    for (const field of Object.keys(BASE_CREATE)) {
      await expectBadRequestOn(
        UpdateModelProviderDto,
        { name: 'keep', [field]: null },
        FAILURE_TEXT[field],
      );
    }
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { apiKey: null },
      FAILURE_TEXT.apiKey,
    );
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { protocol: null },
      FAILURE_TEXT.protocol,
    );
  });

  it('更新：空串与纯空白串被 400（留空必须表现为不发送该字段）', async () => {
    // 空串是合法 string，IsString 通过，由 minLength 报「过短」——与 null 报「应为文本」区分开
    await expectBadRequestOn(UpdateModelProviderDto, { name: '' }, '名称过短');
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { name: '   ' },
      '名称过短',
    );
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { apiKey: '' },
      'apiKey过短',
    );
  });
});
