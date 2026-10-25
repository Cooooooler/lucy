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
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { KnowledgeRetrievalMode } from '../entities/knowledge-base.entity.js';
import { KnowledgeBaseContentDto } from './knowledge-base-content.dto.js';

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
