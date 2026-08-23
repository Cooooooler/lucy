import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: '名称', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: '描述', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: 'private',
  })
  @IsOptional()
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;
}
