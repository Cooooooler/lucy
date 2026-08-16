import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity.js';
import { Message } from './message.entity.js';

@Entity('ai_conversations')
export class Conversation {
  @ApiProperty({ description: '会话 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '归属用户 ID' })
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ApiProperty({ description: '标题', type: String, nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  title: string | null;

  @ApiProperty({ description: '会话默认模型', type: String, nullable: true })
  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @ApiProperty({ description: '消息列表', type: () => [Message] })
  @OneToMany(() => Message, (m) => m.conversation)
  messages: Message[];

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
