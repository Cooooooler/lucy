import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
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

/**
 * AI 对话会话：归属用户 + 默认模型 + 标题，一对多持有 Message。
 *
 * `(user_id, updated_at, id)` 同时服务两件事：按用户查询（前缀即 `user_id`，故不再单独
 * 建 `user_id` 索引，避免冗余索引），以及会话列表的 keyset 分页
 * `ORDER BY updated_at DESC, id DESC` —— `@Index` 只能表达 ASC，反向索引扫描即可满足。
 * 索引由 `migration:generate` 从实体产出（实体是 schema 的唯一来源），不手写 DDL。
 */
@Entity('ai_conversations')
@Index('IDX_ai_conversations_user_updated_id', ['userId', 'updatedAt', 'id'])
export class Conversation {
  @ApiProperty({ description: '会话 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '归属用户 ID' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ApiHideProperty()
  // 关系对象：出网与否由全局序列化拦截器依据 @Exclude 决定（@ApiHideProperty 只管 Swagger）。
  // User 带 passwordHash，populate 后漏标即随嵌套对象出网。
  @Exclude()
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
  // 毫秒精度靠**列类型**保证（`timestamptz(3)`），不靠列默认值：DEFAULT 只在 INSERT 生效，
  // 而 updated_at 是后续每次 UPDATE 都会重写的列（由 ORM 注入值），microsecond 一旦落进去，
  // 毫秒精度的游标就会向下截断、同一毫秒内的行在下一页被整批跳过（静默漏数据）。
  // 精度写进类型后，无论 ORM、seed 还是直写 SQL 都是毫秒粒度。
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    precision: 3,
  })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  // 同上，且它正是会话列表的排序键，必须与 created_at 的精度保持一致
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    precision: 3,
  })
  updatedAt: Date;
}
