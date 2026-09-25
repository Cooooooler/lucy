import type { CursorPageResult } from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';
import { ConversationItemDto } from './conversation-item.dto.js';

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
