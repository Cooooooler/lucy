import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

export class KnowledgeListQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: '按可见性过滤',
    enum: KnowledgeBaseVisibility,
  })
  @IsOptional()
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;

  @ApiPropertyOptional({ description: '名称关键字' })
  @IsOptional()
  @IsString()
  name?: string;
}
