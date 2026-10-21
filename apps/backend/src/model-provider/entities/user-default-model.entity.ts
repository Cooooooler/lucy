import { ApiHideProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity.js';
import { ModelProvider } from './model-provider.entity.js';

/**
 * 用户默认模型：每种模型类型至多一条（由服务层整体替换保证）。
 *
 * 刻意不存 `type` 列——类型由关联的 `ModelProvider` 派生，不会留下「类型写死、指向
 * 另一个类型」的行。代价是模型改类型后，旧类型下的默认设置失去意义；因此改类型时由
 * 服务层在同一事务里删除指向该模型的默认项（见 `ModelProviderDefaultsService.clearForProvider`），
 * 否则它会与同类型的另一条默认项派生出重复的 `type`。
 * 唯一键只约束同一模型不重复成为默认项。
 *
 * `model_provider_id` 的 FK 需要独立索引：删除模型时 ON DELETE CASCADE 要按该列定位
 * 引用行（TypeORM 不会为 FK 列自动建索引）；按属主查询则复用唯一索引的 `owner_id` 前缀。
 */
@Entity('user_default_models')
@Unique(['ownerId', 'modelProviderId'])
@Index('IDX_user_default_models_model_provider', ['modelProviderId'])
export class UserDefaultModel {
  @ApiHideProperty()
  @Exclude()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'model_provider_id', type: 'uuid' })
  modelProviderId: string;

  @ApiHideProperty()
  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_id',
    foreignKeyConstraintName: 'FK_user_default_models_owner',
  })
  owner?: User;

  @ApiHideProperty()
  @Exclude()
  @ManyToOne(() => ModelProvider, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'model_provider_id',
    foreignKeyConstraintName: 'FK_user_default_models_model_provider',
  })
  modelProvider?: ModelProvider;

  @ApiHideProperty()
  @Exclude()
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  createdAt: Date;

  @ApiHideProperty()
  @Exclude()
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => "date_trunc('milliseconds', now())",
  })
  updatedAt: Date;
}
