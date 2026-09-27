import { ApiProperty } from '@nestjs/swagger';
import { MessageRole, MessageStatus } from '../entities/message.entity.js';
import { ConversationItemDto } from './conversation-item.dto.js';

/**
 * 单条消息的对外契约项（**允许式**白名单，同 `ConversationItemDto`）。
 *
 * 不复用持久化实体 `Message`：全局 `ClassSerializerInterceptor` 是排除式的，
 * 拿实体当契约等于「新增列默认出网」；显式白名单让出网字段在编译期与契约里可见。
 * 刻意不含内部关系对象 `conversation`（实体上已 `@Exclude()`，这里从类型上就不存在）。
 */
export class MessageItemDto {
  @ApiProperty({ description: '消息 ID' })
  id: string;

  @ApiProperty({ description: '所属会话 ID' })
  conversationId: string;

  @ApiProperty({ description: '角色', enum: MessageRole })
  role: MessageRole;

  @ApiProperty({ description: '内容' })
  content: string;

  @ApiProperty({
    description: '思考过程（深度思考模型，可空）',
    type: String,
    nullable: true,
  })
  thinking: string | null;

  @ApiProperty({ description: '生成状态', enum: MessageStatus, nullable: true })
  status: MessageStatus | null;

  @ApiProperty({
    description: '是否被长度截断（done_reason=length，可空）',
    type: Boolean,
    nullable: true,
  })
  truncated: boolean | null;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;
}

/**
 * 会话详情契约：会话元信息（继承 `ConversationItemDto` 的允许式字段）+
 * 时间正序的消息列表。由 `AiService.get` 经 `toConversationDetail` 映射，
 * 取代此前直接返回 `Conversation` 实体（会带上 `userId` 等非契约字段）的做法。
 */
export class ConversationDetailDto extends ConversationItemDto {
  @ApiProperty({
    description: '消息列表（时间正序）',
    type: () => [MessageItemDto],
  })
  messages: MessageItemDto[];
}
