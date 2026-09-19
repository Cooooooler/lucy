import { ApiProperty } from '@nestjs/swagger';
import { Conversation } from '../entities/conversation.entity.js';

export class ConversationListResultDto {
  @ApiProperty({ description: '会话列表', type: [Conversation] })
  list: Conversation[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
    example: null,
  })
  nextCursor: string | null;
}
