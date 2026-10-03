import { MODEL_PROVIDER_NAME_MAX_LENGTH } from '@lucy/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../common/pagination/dto/cursor-query.dto.js';
import { ModelProviderType } from '../entities/model-provider.entity.js';

/** 模型供应商列表请求参数：分页继承 `CursorQueryDto`，这里只声明本列表的过滤字段。 */
export class ModelProviderListQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    description: '按模型类型过滤',
    enum: ModelProviderType,
  })
  @IsOptional()
  @IsEnum(ModelProviderType)
  type?: ModelProviderType;

  // 长度上限与 cursor 的边界策略一致：该关键字会拼成 `ILIKE '%…%'`，谓词无法走索引，
  // 超长输入是廉价的全表扫描放大器；顺带去掉首尾空白
  @ApiPropertyOptional({
    description: `名称关键字（最多 ${MODEL_PROVIDER_NAME_MAX_LENGTH} 字符）`,
    maxLength: MODEL_PROVIDER_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(MODEL_PROVIDER_NAME_MAX_LENGTH)
  name?: string;
}
