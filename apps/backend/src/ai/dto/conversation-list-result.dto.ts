import type { CursorPageResult } from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 会话对外契约项（**允许式**白名单，同 `KnowledgeBaseItemDto` / `UserListItemDto`）。
 *
 * 不复用持久化实体 `Conversation`：全局 `ClassSerializerInterceptor` 是**排除式**的
 * （只剔除显式标注 `@Exclude()` 的字段），拿实体当契约等于「新增字段默认出网」；
 * 显式白名单让「哪些列能出网」在编译期与生成的契约里都是可见的事实。
 *
 * 刻意不含 `userId`：列表本来就只返回调用者自己的会话，回传归属者 id 没有信息量。
 * 详情 / 创建 / 改名端点仍返回实体，其出网集合由 `entity-serialization.spec.ts` 的
 * 允许清单守卫。
 */
export class ConversationItemDto {
  @ApiProperty({ description: '会话 ID' })
  id: string;

  @ApiProperty({ description: '标题', type: String, nullable: true })
  title: string | null;

  @ApiProperty({ description: '会话默认模型', type: String, nullable: true })
  model: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/** 会话列表响应：游标分页的 list + nextCursor（形状由共享 `CursorPageResult` 编译期约束） */
export class ConversationListResultDto implements CursorPageResult<ConversationItemDto> {
  @ApiProperty({ description: '会话列表', type: () => [ConversationItemDto] })
  list: ConversationItemDto[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}
