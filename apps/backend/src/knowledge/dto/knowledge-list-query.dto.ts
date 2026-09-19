import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../common/pagination/dto/cursor-query.dto.js';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

/** 知识库列表的请求参数：分页部分继承 `CursorQueryDto`，这里只声明本列表自己的过滤字段。 */
export class KnowledgeListQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    description: '按可见性过滤',
    enum: KnowledgeBaseVisibility,
  })
  @IsOptional()
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;

  // 长度上限与 cursor 的边界策略保持一致：该关键字会拼成 `ILIKE '%…%'`，
  // 谓词无法走索引，超长输入是廉价的全表扫描放大器；顺带去掉首尾空白
  @ApiPropertyOptional({ description: '名称关键字（最多 100 字符）' })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(100)
  name?: string;
}
