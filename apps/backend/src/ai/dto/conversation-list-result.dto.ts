import { ApiProperty } from '@nestjs/swagger';
import { Conversation } from '../entities/conversation.entity.js';

export class ConversationListResultDto {
  @ApiProperty({ description: '会话列表', type: [Conversation] })
  list: Conversation[];

  @ApiProperty({ description: '总条数', example: 0 })
  total: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize: number;
}
