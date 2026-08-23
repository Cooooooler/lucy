import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity.js';

export enum MessageRole {
  User = 'user',
  Ai = 'ai',
  System = 'system',
}

export enum MessageStatus {
  Complete = 'complete',
  Aborted = 'aborted',
  Failed = 'failed',
}

/** 会话内单条消息：角色 + 内容 + 生成状态；索引 (conversationId, createdAt) 支撑按时间正序拉取历史 */
@Entity('ai_messages')
@Index('IDX_ai_messages_conversation_created', ['conversationId', 'createdAt'])
export class Message {
  @ApiProperty({ description: '消息 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '所属会话 ID' })
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ApiHideProperty()
  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;

  @ApiProperty({ description: '角色', enum: MessageRole })
  @Column({ type: 'enum', enum: MessageRole })
  role: MessageRole;

  @ApiProperty({ description: '内容' })
  @Column({ type: 'text' })
  content: string;

  @ApiPropertyOptional({
    description: '思考过程（深度思考模型，可空）',
    type: String,
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  thinking: string | null;

  @ApiProperty({ description: '生成状态', enum: MessageStatus, nullable: true })
  @Column({ type: 'enum', enum: MessageStatus, nullable: true })
  status: MessageStatus | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
