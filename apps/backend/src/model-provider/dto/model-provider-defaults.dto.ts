import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ModelProviderType } from '../entities/model-provider.entity.js';

/** 单个模型类型的默认模型（只读视图） */
export class ModelProviderDefaultItemDto {
  @ApiProperty({ description: '模型类型', enum: ModelProviderType })
  type: ModelProviderType;

  @ApiProperty({
    description: '默认模型配置 ID；null 表示该类型未设置默认模型',
    type: String,
    nullable: true,
  })
  modelProviderId: string | null;
}

/** 用户默认模型设置：覆盖全部模型类型，未设置的为 null */
export class ModelProviderDefaultsDto {
  @ApiProperty({
    description: '各模型类型的默认模型',
    type: [ModelProviderDefaultItemDto],
  })
  defaults: ModelProviderDefaultItemDto[];
}

/** 更新项：`modelProviderId` 为 null 表示清除该类型的默认模型 */
export class UpdateModelProviderDefaultItemDto {
  @ApiProperty({ description: '模型类型', enum: ModelProviderType })
  @IsEnum(ModelProviderType)
  type: ModelProviderType;

  @ApiProperty({
    description: '默认模型配置 ID；null 表示清除',
    type: String,
    nullable: true,
  })
  // @IsOptional 对 null 同样跳过校验：null 是「清除」的合法取值，不是缺字段
  @IsOptional()
  @IsUUID()
  modelProviderId: string | null;
}

/** 整体替换用户的默认模型设置 */
export class UpdateModelProviderDefaultsDto {
  @ApiProperty({
    description: '各模型类型的默认模型（整体替换，未列出的类型视为清除）',
    type: [UpdateModelProviderDefaultItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateModelProviderDefaultItemDto)
  defaults: UpdateModelProviderDefaultItemDto[];
}
