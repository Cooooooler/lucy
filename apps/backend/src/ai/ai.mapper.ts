import type { ConversationItemDto } from './dto/conversation-list-result.dto.js';
import type { Conversation } from './entities/conversation.entity.js';

/**
 * 把会话实体映射为列表项契约视图（允许式白名单，理由见 `ConversationItemDto`）。
 *
 * 逐字段取出而不是展开实体：新增列不会自动进入列表响应，除非在这里显式加上。
 */
export function toConversationItem(
  conversation: Conversation,
): ConversationItemDto {
  const { id, title, model, createdAt, updatedAt } = conversation;
  return { id, title, model, createdAt, updatedAt };
}
