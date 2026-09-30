import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
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
  // 关系对象：出网与否由全局序列化拦截器依据 @Exclude 决定（@ApiHideProperty 只管 Swagger）
  @Exclude()
  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  // 用 Relation<T> 而非裸 Conversation：Message 与 Conversation 互相导入形成环，
  // tsc 的 emitDecoratorMetadata 会把**属性类型**写成 `__metadata("design:type", Conversation)`
  // 并在模块求值时求值该引用——当 conversation.entity 先被加载时，Conversation 尚在 TDZ，
  // 报 `Cannot access 'Conversation' before initialization`。Relation<T> 是类型别名（=`T`），
  // 元数据退化为 Object，环上的急切引用随之消失（TypeORM 官方对循环关系的推荐写法）。
  conversation?: Relation<Conversation>;

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

  @ApiPropertyOptional({
    description: '是否被长度截断（done_reason=length，可空）',
    type: Boolean,
    nullable: true,
  })
  @Column({ type: 'boolean', nullable: true })
  truncated: boolean | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
