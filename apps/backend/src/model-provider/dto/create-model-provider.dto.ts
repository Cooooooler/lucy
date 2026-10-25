import {
  MODEL_API_KEY_MAX_LENGTH,
  MODEL_BASE_URL_MAX_LENGTH,
  MODEL_CONTEXT_LENGTH_MAX,
  MODEL_CONTEXT_LENGTH_MIN,
  MODEL_PROVIDER_NAME_MAX_LENGTH,
} from '@lucy/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from '../entities/model-provider.entity.js';

/**
 * 创建模型供应商。
 *
 * 校验装饰器与 Swagger `@ApiProperty` 选项**必须两处同步写**：本项目的 @nestjs/swagger 不解析
 * class-validator 装饰器（未启用 CLI 插件），只写装饰器时文档里就是无边界字符串。
 */
export class CreateModelProviderDto {
  @ApiProperty({
    description: '模型名称',
    minLength: 1,
    maxLength: MODEL_PROVIDER_NAME_MAX_LENGTH,
  })
  // trim 后再校验：纯空白串会被 @MinLength(1) 拦下，避免存出显示为空的「幽灵」模型
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MinLength(1)
  @MaxLength(MODEL_PROVIDER_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ description: '模型类型', enum: ModelProviderType })
  @IsEnum(ModelProviderType)
  type: ModelProviderType;

  @ApiProperty({ description: '模型供应商', enum: ModelProviderVendor })
  @IsEnum(ModelProviderVendor)
  vendor: ModelProviderVendor;

  @ApiProperty({
    description: 'API Base URL（http/https）',
    maxLength: MODEL_BASE_URL_MAX_LENGTH,
  })
  // require_tld: false —— validator.js 默认要求主机名带 TLD，会拒掉 Ollama 的
  // `http://localhost:11434`（IP 主机名不受该开关影响，故 `127.0.0.1` 本来就能过）。
  // 供应商地址允许本地/内网主机，这里只约束协议与形态。
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'API Base URL 必须是 http/https 协议的合法地址' },
  )
  @MaxLength(MODEL_BASE_URL_MAX_LENGTH)
  baseUrl: string;

  // 不写 Swagger 的 `default`：openapi-typescript 的 defaultNonNullable 会把带 default 的属性
  // 判成必填（`protocol` 就变成 required），与「省略时取默认值」的运行语义相悖。默认值由服务层
  // （create 的 `dto.protocol ?? ChatCompletions`）承担，文档里用描述说明即可。
  @ApiPropertyOptional({
    description: `API 协议（仅 LLM 有意义），省略时默认 ${ModelProviderProtocol.ChatCompletions}`,
    enum: ModelProviderProtocol,
  })
  // 用 @ValidateIf(value !== undefined) 而非 @IsOptional()：后者把 null 与 undefined 一视同仁地
  // 跳过校验，且会被 PartialType 原样拷进更新 DTO——显式 `{"protocol": null}` 穿过校验进入服务层
  //（撞协议列的 NOT NULL 约束被兜成 500）。这里只放行「省略」，显式 null 落到 400，创建/更新两侧同口径。
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ModelProviderProtocol)
  protocol?: ModelProviderProtocol;

  @ApiProperty({
    description: '模型上下文长度（token）',
    minimum: MODEL_CONTEXT_LENGTH_MIN,
    maximum: MODEL_CONTEXT_LENGTH_MAX,
    example: 32768,
  })
  @Type(() => Number)
  @IsInt()
  @Min(MODEL_CONTEXT_LENGTH_MIN)
  @Max(MODEL_CONTEXT_LENGTH_MAX)
  contextLength: number;

  // ollama 通常无鉴权，允许省略；openai/anthropic 的必填由服务层按 vendor 校验。
  // 与上同理用 @ValidateIf 而非 @IsOptional：省略（undefined）不校验，显式 null 落到 400，
  // 且不会作为 IsOptional 条件被 PartialType 拷进更新 DTO 放行 null。
  // @Transform trim 后再校验：纯空白串是合法 string 且长度 ≥1，不 trim 会穿过
  // @MinLength(1)，创建时在服务层变成「领域提示的 400」，更新时则静默清空已存 Key。
  @ApiPropertyOptional({
    description: 'API Key（明文传入，服务端加密存储）；ollama 可省略',
    minLength: 1,
    maxLength: MODEL_API_KEY_MAX_LENGTH,
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MODEL_API_KEY_MAX_LENGTH)
  apiKey?: string;
}
