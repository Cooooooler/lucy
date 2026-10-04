import type {
  ConversationDetailDto,
  MessageItemDto,
} from './dto/conversation-detail.dto.js';
import type { ConversationItemDto } from './dto/conversation-item.dto.js';
import type { Conversation } from './entities/conversation.entity.js';
import type { Message } from './entities/message.entity.js';

/**
 * 把会话实体映射为对外契约视图（允许式白名单，理由见 `ConversationItemDto`）；
 * 列表 / 创建 / 改名三个端点共用同一份形状。
 *
 * 逐字段取出而不是展开实体：新增列不会自动进入响应，除非在这里显式加上。
 */
export function toConversationItem(
  conversation: Conversation,
): ConversationItemDto {
  const { id, title, modelProviderId, createdAt, updatedAt } = conversation;
  return { id, title, modelProviderId, createdAt, updatedAt };
}

/** 把消息实体映射为对外契约视图（允许式白名单）。 */
export function toMessageItem(message: Message): MessageItemDto {
  const {
    id,
    conversationId,
    role,
    content,
    thinking,
    status,
    truncated,
    createdAt,
  } = message;
  return {
    id,
    conversationId,
    role,
    content,
    thinking,
    status,
    truncated,
    createdAt,
  };
}

/**
 * 把会话实体与消息列表映射为详情契约视图（允许式白名单，是 `ConversationItemDto` 的超集）。
 * 消息由调用方单独查出后传入，避免在实体上写回 `messages` 使其「关系被 populate」而出网。
 */
export function toConversationDetail(
  conversation: Conversation,
  messages: Message[],
): ConversationDetailDto {
  return {
    ...toConversationItem(conversation),
    messages: messages.map(toMessageItem),
  };
}
