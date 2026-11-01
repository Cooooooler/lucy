import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

/**
 * 可见性切换请求。
 *
 * 可见性切换与整表单更新分成两个端点后，成功文案依据响应里的 `visibility`
 * （服务端事实），而不是「请求体是否只有一个键」这类形状启发式。
 */
export class UpdateKnowledgeVisibilityDto {
  @ApiProperty({ description: '可见性', enum: KnowledgeBaseVisibility })
  @IsEnum(KnowledgeBaseVisibility)
  visibility: KnowledgeBaseVisibility;
}
