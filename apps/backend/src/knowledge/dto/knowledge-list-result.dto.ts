import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeBase } from '../entities/knowledge-base.entity.js';

/**
 * 知识库列表响应：游标分页的 list + nextCursor。
 * 独立 DTO 只为让 Swagger 产出 200 的响应 schema——此前控制器只有
 * `@ApiResponse({ description })`，生成的 200 响应是 `content?: never`，
 * 前端无法据此获得契约类型。
 *
 * 契约边界说明：`list` 的元素类型就是实体 `KnowledgeBase` 本身（本仓库**实体即对外契约**），
 * 不是另设的响应 DTO。真实响应 = 实体字段中**未被 `@Exclude()` 排除**的部分；
 * 全局注册的 `ClassSerializerInterceptor`（CommonModule）负责按 `@Exclude()` 做
 * 「排除式白名单」——全局而非按控制器挂载，实体从任何控制器返回都受同一保护。
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

/**
 * 文档列表项：与知识库列表不同，这里**不复用实体**，而是一份显式允许式白名单
 * （同 users 模块的 `UserListItemDto` + `user.mapper.ts` 的做法）。
 *
 * 关键差异是刻意**不含 `content`**：它是解析出的纯文本，可达 MB 级，列表页只用标题/时间；
 * `content` 只由 `GET /knowledge/:kbId/documents/:id` 详情接口返回。
 * 列表查询同时做了列投影（见 `KnowledgeService.listDocuments`），避免把整列读出来。
 * 这样一来「列表误带全文」不是靠记得加 `@Exclude()` 来避免，而是类型上就不存在。
 */
export class KnowledgeDocumentListItemDto {
  @ApiProperty({ description: '文档 ID' })
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  fileId: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/** 文档列表响应：游标分页的 list + nextCursor（list 元素见 KnowledgeDocumentListItemDto） */
export class DocumentListResultDto {
  @ApiProperty({
    description: '文档列表（不含解析全文 content）',
    type: () => [KnowledgeDocumentListItemDto],
  })
  list: KnowledgeDocumentListItemDto[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}
