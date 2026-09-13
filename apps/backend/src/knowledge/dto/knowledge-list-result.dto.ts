import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeBase } from '../entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../entities/knowledge-document.entity.js';

/**
 * 知识库列表响应：游标分页的 list + nextCursor。
 * 独立 DTO 只为让 Swagger 产出 200 的响应 schema——此前控制器只有
 * `@ApiResponse({ description })`，生成的 200 响应是 `content?: never`，
 * 前端无法据此获得契约类型。
 *
 * 契约边界说明：`list` 的元素类型就是实体 `KnowledgeBase` 本身（本仓库**实体即对外契约**），
 * 不是另设的响应 DTO。真实响应 = 实体字段中**未被 `@Exclude()` 排除**的部分；
 * 控制器上的 `ClassSerializerInterceptor` 负责按 `@Exclude()` 做「排除式白名单」。
 * 因此新增**内部/敏感字段**时必须同步给该字段加 `@Exclude()`，否则它会同时进入
 * 真实响应与 Swagger 契约。
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

/** 文档列表响应：游标分页的 list + nextCursor（同 KnowledgeListResultDto：list 元素就是实体 KnowledgeDocument，内部字段由 @Exclude 排除） */
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
