import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
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
  Assistant = 'assistant',
  System = 'system',
}

export enum MessageStatus {
  Complete = 'complete',
  Aborted = 'aborted',
  Failed = 'failed',
}

@Entity('ai_messages')
export class Message {
  @ApiProperty({ description: '消息 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '所属会话 ID' })
  @Index()
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

  @ApiProperty({ description: '生成状态', enum: MessageStatus, nullable: true })
  @Column({ type: 'enum', enum: MessageStatus, nullable: true })
  status: MessageStatus | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
