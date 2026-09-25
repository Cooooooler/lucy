import { ApiProperty } from '@nestjs/swagger';

/**
 * 会话对外契约项（**允许式**白名单，同 `KnowledgeBaseItemDto` / `UserListItemDto`）。
 *
 * 不复用持久化实体 `Conversation`：全局 `ClassSerializerInterceptor` 是**排除式**的
 * （只剔除显式标注 `@Exclude()` 的字段），拿实体当契约等于「新增字段默认出网」；
 * 显式白名单让「哪些列能出网」在编译期与生成的契约里都是可见的事实。
 *
 * 刻意不含 `userId`：列表本来就只返回调用者自己的会话，回传归属者 id 没有信息量；
 * 创建/改名同样返回本形态（它们不 populate `messages`，契约里就不该有必填关系）。
 *
 * 归属独立文件而不是挂在 `conversation-list-result.dto.ts` 下：它同时是列表项、
 * 创建响应与改名响应三种语义共用的契约，放在「列表结果」里会让契约归属含糊。
 * 唯一仍以实体出网的是详情端点（`GET /ai/conversations/:id`，它确实 populate 了
 * `messages`），其出网集合由 `entity-serialization.spec.ts` 的允许清单守卫。
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
