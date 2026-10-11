import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: '名称', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '描述', minLength: 1, maxLength: 200 })
  // trim 后再校验：纯空白串被 @MinLength(1) 拦下。描述现要求非空，
  // 但「非空」的口径必须与迁移（把空串一并回填）和前端表单（whitespace 校验）一致，
  // 否则 API 仍能写入空描述。@MinLength 不产出文档边界，Swagger 侧的 minLength 需手写。
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description: string;

  @ApiPropertyOptional({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: 'private',
  })
  // 用 @ValidateIf(value !== undefined) 而非 @IsOptional()：后者把 null 与 undefined
  // 一视同仁地跳过校验，显式 `null` 会穿过校验进入服务层（更新路径上撞 NOT NULL 约束被
  // 兜成 500）。这里只放行「省略」，显式 null 落到 400，创建/更新两侧口径一致。
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;
}
