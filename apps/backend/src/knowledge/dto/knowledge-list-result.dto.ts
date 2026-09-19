import type { CursorPageResult } from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

/**
 * 知识库对外契约项（**允许式**白名单，同 users 模块的 `UserListItemDto`）。
 *
 * 不复用持久化实体 `KnowledgeBase`：全局 ClassSerializerInterceptor 是**排除式**的
 * （只剔除显式标注 `@Exclude()` 的字段），拿实体当契约等于「新增字段默认出网」。
 * 独立 DTO 让实体与契约的漂移在编译期/契约生成期暴露，而不是静默泄漏。
 *
 * 字段集在**所有**返回知识库的端点上完全一致（create/get/list/update）：
 * `likeCount`/`isLiked` 是查询期计算的视图字段（非持久化列），此前只有 get/list 附带，
 * 导致同一实体在不同端点有两种形状、前端只能全声明成可选；现在服务层统一填充。
 * 真实响应 = 本 DTO 的字段；实体上的 `owner` 等内部关系对象不在此列。
 */
export class KnowledgeBaseItemDto {
  @ApiProperty({ description: '知识库 ID' })
  id: string;

  @ApiProperty({ description: '属主用户 ID' })
  ownerId: string;

  @ApiProperty({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: KnowledgeBaseVisibility.Private,
  })
  visibility: KnowledgeBaseVisibility;

  @ApiProperty({ description: '名称' })
  name: string;

  @ApiProperty({ description: '描述', type: String, nullable: true })
  description: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;

  @ApiProperty({ description: '点赞数', example: 0 })
  likeCount: number;

  @ApiProperty({ description: '当前用户是否已点赞', example: false })
  isLiked: boolean;
}

/** 知识库列表响应：游标分页的 list + nextCursor（形状由共享 `CursorPageResult` 编译期约束） */
export class KnowledgeListResultDto implements CursorPageResult<KnowledgeBaseItemDto> {
  @ApiProperty({
    description: '知识库列表',
    type: () => [KnowledgeBaseItemDto],
  })
  list: KnowledgeBaseItemDto[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}

/**
 * 文档列表项：同样是一份显式允许式白名单。
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

/** 文档列表响应：游标分页的 list + nextCursor（形状由共享 `CursorPageResult` 编译期约束） */
export class DocumentListResultDto implements CursorPageResult<KnowledgeDocumentListItemDto> {
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

/**
 * 文档详情/上传响应（允许式白名单，是列表项的超集：多一个解析全文 `content`）。
 *
 * 不复用 `KnowledgeDocument` 实体：实体是持久化结构，拿它当契约意味着「新增列默认出网」
 * （全局 ClassSerializerInterceptor 是排除式的，只剔除显式 `@Exclude()` 的字段）；
 * 显式列白名单则让「哪一列能出网」是编译期/契约生成期可见的事实，且只有本 DTO 会带 `content`。
 * 上传返回同一形状，前端拿到的类型与详情一致。
 */
export class KnowledgeDocumentDetailDto {
  @ApiProperty({ description: '文档 ID' })
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  fileId: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiProperty({
    description: '解析出的纯文本',
    type: String,
    nullable: true,
  })
  content: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}
