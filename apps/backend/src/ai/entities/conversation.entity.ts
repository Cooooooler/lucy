import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ModelProvider } from '../../model-provider/entities/model-provider.entity.js';
import { User } from '../../users/user.entity.js';

/**
 * AI 对话会话：归属用户 + 默认模型配置（`modelProviderId`）+ 标题。
 *
 * 刻意不声明 `messages` 反向关系（`@OneToMany`）：会话侧从不 populate 消息，服务一律按
 * `conversationId` 单独查询；反向关系还会让本实体与 `Message` 互相 import 成环，踩中 tsc
 * `emitDecoratorMetadata` 的 TDZ（详见 `Message.conversation`）。`@OneToMany` 本就不产生
 * 任何 DB schema，故删除它不影响迁移。
 *
 * `(user_id, updated_at, id)` 同时服务两件事：按用户查询（前缀即 `user_id`，故不再单独
 * 建 `user_id` 索引，避免冗余索引），以及会话列表的 keyset 分页
 * `ORDER BY updated_at DESC, id DESC` —— `@Index` 只能表达 ASC，反向索引扫描即可满足。
 * 索引由 `migration:generate` 从实体产出（实体是 schema 的唯一来源），不手写 DDL。
 */
@Entity('ai_conversations')
@Index('IDX_ai_conversations_user_updated_id', ['userId', 'updatedAt', 'id'])
// model_provider_id 的 FK 需自带索引：删除 ModelProvider 时 ON DELETE SET NULL 会按该列定位
// 引用行，无索引则退化为全表扫描（TypeORM 不会为 FK 列自动建索引）
@Index('IDX_ai_conversations_model_provider', ['modelProviderId'])
export class Conversation {
  @ApiProperty({ description: '会话 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 内部字段：会话相关端点全部返回允许式 DTO（ConversationItemDto / ConversationDetailDto），
  // 实体已不再作为响应出网。仍标 @Exclude 作纵深防御——若将来有人误把实体当契约返回，
  // 归属关系不会随之泄漏（由 entity-serialization.spec 的出网白名单把关）。
  @ApiHideProperty()
  @Exclude()
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

  @ApiProperty({
    description: '会话默认模型（模型配置 ID）',
    type: String,
    nullable: true,
  })
  @Column({ name: 'model_provider_id', type: 'uuid', nullable: true })
  modelProviderId: string | null;

  @ApiHideProperty()
  // 出网与否由全局序列化拦截器依据 @Exclude 决定（@ApiHideProperty 只管 Swagger）。
  // ON DELETE SET NULL：删除模型配置时仅断开会话的引用，不连带删除会话。
  @Exclude()
  @ManyToOne(() => ModelProvider, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'model_provider_id',
    foreignKeyConstraintName: 'FK_ai_conversations_model_provider',
  })
  modelProvider?: ModelProvider;

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
