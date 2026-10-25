import {
  KNOWLEDGE_SCORE_THRESHOLD_DEFAULT,
  KNOWLEDGE_SCORE_THRESHOLD_MAX,
  KNOWLEDGE_SCORE_THRESHOLD_MIN,
  KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT,
  KNOWLEDGE_SEMANTIC_WEIGHT_MAX,
  KNOWLEDGE_SEMANTIC_WEIGHT_MIN,
  KNOWLEDGE_TOP_K_DEFAULT,
  KNOWLEDGE_TOP_K_MAX,
  KNOWLEDGE_TOP_K_MIN,
} from '@lucy/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  KnowledgeBaseVisibility,
  KnowledgeRetrievalMode,
} from '../entities/knowledge-base.entity.js';

/**
 * 知识库可在创建后修改的内容字段。
 *
 * 单独抽出基类供创建/更新两个 DTO 复用：更新侧只映射这一组，**检索设置创建后不可改**。
 * 若让更新 DTO 继续继承 `CreateKnowledgeBaseDto`，检索字段会跟着进 PATCH 契约。
 */
export class KnowledgeBaseContentDto {
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

/**
 * 创建知识库参数：内容字段 + 检索设置（检索设置仅创建时可写）。
 *
 * 检索字段全部可选，省略即取默认值（与实体列默认值一致）：全文检索、topK=5、
 * Score 阈值关闭且为 0、语义权重 50、不重排。
 */
export class CreateKnowledgeBaseDto extends KnowledgeBaseContentDto {
  // 注意：这里刻意不写 `default`——openapi-typescript 的 defaultNonNullable 会把带
  // default 的属性生成成**必填**，与运行时「省略即取默认值」不符。默认值写进描述。
  @ApiPropertyOptional({
    description: `检索模式（省略时默认 ${KnowledgeRetrievalMode.FullText}）`,
    enum: KnowledgeRetrievalMode,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(KnowledgeRetrievalMode)
  retrievalMode?: KnowledgeRetrievalMode;

  @ApiPropertyOptional({
    description: `召回条数（省略时默认 ${KNOWLEDGE_TOP_K_DEFAULT}）`,
    minimum: KNOWLEDGE_TOP_K_MIN,
    maximum: KNOWLEDGE_TOP_K_MAX,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(KNOWLEDGE_TOP_K_MIN)
  @Max(KNOWLEDGE_TOP_K_MAX)
  topK?: number;

  @ApiPropertyOptional({
    description: '是否启用 Score 阈值过滤（省略时默认关闭）',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  scoreThresholdEnabled?: boolean;

  @ApiPropertyOptional({
    description: `Score 阈值（仅启用时生效，省略时默认 ${KNOWLEDGE_SCORE_THRESHOLD_DEFAULT}；启用时必须大于 0）`,
    minimum: KNOWLEDGE_SCORE_THRESHOLD_MIN,
    maximum: KNOWLEDGE_SCORE_THRESHOLD_MAX,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(KNOWLEDGE_SCORE_THRESHOLD_MIN)
  @Max(KNOWLEDGE_SCORE_THRESHOLD_MAX)
  scoreThreshold?: number;

  @ApiPropertyOptional({
    description: `混合检索的语义权重（关键词权重 = 100 - 该值，省略时默认 ${KNOWLEDGE_SEMANTIC_WEIGHT_DEFAULT}）`,
    minimum: KNOWLEDGE_SEMANTIC_WEIGHT_MIN,
    maximum: KNOWLEDGE_SEMANTIC_WEIGHT_MAX,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(KNOWLEDGE_SEMANTIC_WEIGHT_MIN)
  @Max(KNOWLEDGE_SEMANTIC_WEIGHT_MAX)
  semanticWeight?: number;

  @ApiPropertyOptional({
    description: '重排模型配置 ID；null 或省略表示不重排',
    type: String,
    format: 'uuid',
    nullable: true,
  })
  // 这里的 null 是合法值（= 不重排），故用 @IsOptional() 放行 null；
  // 其余检索字段的 null 没有语义，仍用 @ValidateIf 落到 400。
  @IsOptional()
  @IsUUID()
  rerankModelId?: string | null;
}
