import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeBase } from '../entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../entities/knowledge-document.entity.js';

/**
 * 知识库列表响应：游标分页的 list + nextCursor。
 * 独立 DTO 是为了让 Swagger 产出真实响应 schema——此前控制器只有
 * `@ApiResponse({ description })`，生成的 200 响应是 `content?: never`，
 * 前端无法据此获得契约类型。
 */
export class KnowledgeListResultDto {
  @ApiProperty({ description: '知识库列表', type: () => [KnowledgeBase] })
  list: KnowledgeBase[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}

/** 文档列表响应：游标分页的 list + nextCursor（同 KnowledgeListResultDto） */
export class DocumentListResultDto {
  @ApiProperty({ description: '文档列表', type: () => [KnowledgeDocument] })
  list: KnowledgeDocument[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}
