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
import { User } from '../../users/user.entity.js';

/** 模型类型：决定用哪种 LangChain 客户端构造与探测（见 ModelClientFactory） */
export enum ModelProviderType {
  Llm = 'llm',
  TextEmbedding = 'text-embedding',
  Speech2Text = 'speech2text',
  Tts = 'tts',
  Moderation = 'moderation',
}

/** 模型供应商：决定用哪家 LangChain 客户端构造与探测（见 ModelClientFactory） */
export enum ModelProviderVendor {
  Ollama = 'ollama',
  OpenAI = 'openai',
  Anthropic = 'anthropic',
}

/** 调用协议：仅 LLM 有意义（responses → ChatOpenAI.useResponsesApi） */
export enum ModelProviderProtocol {
  ChatCompletions = 'chat-completions',
  Responses = 'responses',
}

/**
 * 模型供应商配置：一条记录 = 一个可直接调用的模型（凭证随行携带，按属主私有）。
 *
 * 索引由下面的 `@Index` 声明——**实体是 schema 的唯一来源**，迁移由 `migration:generate`
 * 从实体产出。第一条服务于属主维度的 keyset 分页（`WHERE owner_id = :uid ORDER BY
 * created_at DESC, id DESC`）；第二条服务于带类型过滤的列表。`@Index` 只能表达 ASC，
 * 降序由 Postgres 的反向索引扫描满足。
 *
 * ⚠️ API Key 以 AES-256-GCM 密文存储（`apiKeyEncrypted`），另存 `apiKeyLast4` 供列表脱敏
 * （免解密）。两者都标 `@Exclude()` + `@ApiHideProperty()`：全局 ClassSerializerInterceptor
 * 是**排除式**的，实体若被当契约返回，漏标即明文出网。对外契约由允许式 `ModelProviderItemDto`
 * 定义（只含 `apiKeyMasked`）。
 */
@Entity('model_providers')
@Index('IDX_model_providers_owner_created_id', ['ownerId', 'createdAt', 'id'])
@Index('IDX_model_providers_owner_type', ['ownerId', 'type'])
export class ModelProvider {
  @ApiProperty({ description: '模型 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '属主用户 ID' })
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiHideProperty()
  // 内部关系对象，不对外暴露（实体其它字段即对外契约，敏感字段务必同步加 @Exclude）
  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_model_providers_owner',
  })
  owner?: User;

  @ApiProperty({ description: '模型名称' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ description: '模型类型', enum: ModelProviderType })
  @Column({ type: 'varchar', length: 20 })
  type: ModelProviderType;

  @ApiProperty({
    description: '模型供应商',
    enum: ModelProviderVendor,
    default: ModelProviderVendor.OpenAI,
  })
  // 默认 openai：存量数据的 baseUrl 语义即 OpenAI 兼容，迁移补列时保持行为不变
  @Column({ type: 'varchar', length: 20, default: ModelProviderVendor.OpenAI })
  vendor: ModelProviderVendor;

  @ApiProperty({ description: 'API Base URL' })
  @Column({ name: 'base_url', type: 'varchar', length: 500 })
  baseUrl: string;

  @ApiProperty({
    description: 'API 协议',
    enum: ModelProviderProtocol,
    default: ModelProviderProtocol.ChatCompletions,
  })
  @Column({
    type: 'varchar',
    length: 20,
    default: ModelProviderProtocol.ChatCompletions,
  })
  protocol: ModelProviderProtocol;

  @ApiProperty({ description: '模型上下文长度（token）' })
  @Column({ name: 'context_length', type: 'int' })
  contextLength: number;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted: string;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'api_key_last4', type: 'varchar', length: 8 })
  apiKeyLast4: string;

  @ApiProperty({ description: '创建时间' })
  // 毫秒对齐：keyset 游标是毫秒精度（JS Date 的固有精度），列默认值若落到微秒，
  // `(created_at, id) < (:cursorTs, :cursorId)` 会在同一毫秒内整批跳行。
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  updatedAt: Date;
}
