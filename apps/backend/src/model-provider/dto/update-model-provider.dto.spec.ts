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
// 中文自定义提示。satisfies 让「进过编译期的键齐全性」兜底：BASE_CREATE/可写侧字段
// 增删或改名时缺项在 typecheck 阶段就失败，而不是运行时 toContain(undefined)。
const FAILURE_TEXT = {
  name: '名称应为文本',
  type: '类型取值不合法',
  vendor: '供应商取值不合法',
  baseUrl: 'Base URL',
  contextLength: '上下文长度应为整数',
  apiKey: '接口密钥应为文本',
  protocol: '协议取值不合法',
} satisfies Record<keyof typeof BASE_CREATE | 'apiKey' | 'protocol', string>;

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

  it('更新：合法值仍可经 PartialType 校验通过（基类 @Transform trim 随继承生效）', async () => {
    const dto = await update({ ...BASE_CREATE, name: '  qwen2  ' });
    expect(dto).toBeInstanceOf(UpdateModelProviderDto);
    // 断言不加 trim：恒真的期望值测不出 transformation metadata 是否随 PartialType 继承
    expect(dto.name).toBe('qwen2');
    expect(dto.type).toBe(ModelProviderType.Llm);
    expect(dto.apiKey).toBeUndefined();
  });

  it('更新：省略字段不校验（不修改语义）', async () => {
    await expect(update({ name: 'x' })).resolves.toBeInstanceOf(
      UpdateModelProviderDto,
    );
  });

  it('更新：显式 null 被各字段自己的校验以 400 拒绝（默认 @IsOptional 会放行 null）', async () => {
    for (const field of Object.keys(
      BASE_CREATE,
    ) as (keyof typeof BASE_CREATE)[]) {
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
    // 空串/纯空白串（trim 后为空）是 IsString 的合法取值，由 minLength 报「过短」
    // ——与 null 报「应为文本」区分开；apiKey trim 防止空白串穿过校验静默清空已存 Key
    await expectBadRequestOn(UpdateModelProviderDto, { name: '' }, '名称过短');
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { name: '   ' },
      '名称过短',
    );
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { apiKey: '' },
      '接口密钥过短',
    );
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { apiKey: '   ' },
      '接口密钥过短',
    );
  });

  it('更新：格式合法但超过 500 字符的 baseUrl 报「接口地址过长」（FIELD_LABELS 收录防漏回归）', async () => {
    // 500 是 maxlength 而 validator.js 的 isUrl 允许到 2048：600-800 字符的合法 URL
    // 会先过 IsUrl 自定义文案、落到 MaxLength —— 这是 baseUrl 唯一不带自定义提示的路径
    await expectBadRequestOn(
      UpdateModelProviderDto,
      { baseUrl: `http://x.example/${'a'.repeat(780)}` },
      '接口地址过长',
    );
  });
});
