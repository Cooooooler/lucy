import type { CursorPageResult } from '@lucy/shared';
import { ApiProperty } from '@nestjs/swagger';
import {
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from '../entities/model-provider.entity.js';

/**
 * 模型供应商对外契约项（**允许式**白名单，同知识库 `KnowledgeBaseItemDto`）。
 *
 * 不复用持久化实体：全局 ClassSerializerInterceptor 是**排除式**的，拿实体当契约等于
 * 「新增字段默认出网」，API Key 密文/尾号就悬在漏标即泄漏的边缘。这里显式列出可出网字段，
 * **只**给脱敏后的 `apiKeyMasked`，明文与密文都不在契约内。
 */
export class ModelProviderItemDto {
  @ApiProperty({ description: '模型 ID' })
  id: string;

  @ApiProperty({ description: '属主用户 ID' })
  ownerId: string;

  @ApiProperty({ description: '模型名称' })
  name: string;

  @ApiProperty({ description: '模型类型', enum: ModelProviderType })
  type: ModelProviderType;

  @ApiProperty({ description: '模型供应商', enum: ModelProviderVendor })
  vendor: ModelProviderVendor;

  @ApiProperty({ description: 'API Base URL' })
  baseUrl: string;

  @ApiProperty({ description: 'API 协议', enum: ModelProviderProtocol })
  protocol: ModelProviderProtocol;

  @ApiProperty({ description: '模型上下文长度（token）' })
  contextLength: number;

  @ApiProperty({
    description: '脱敏后的 API Key（仅尾号，如 ••••••abcd）',
    example: '••••••abcd',
  })
  apiKeyMasked: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;
}

/** 模型供应商列表响应：游标分页的 list + nextCursor（形状由共享 `CursorPageResult` 编译期约束） */
export class ModelProviderListResultDto implements CursorPageResult<ModelProviderItemDto> {
  @ApiProperty({
    description: '模型列表',
    type: () => [ModelProviderItemDto],
  })
  list: ModelProviderItemDto[];

  @ApiProperty({
    description: '下一页游标；null 表示已到末页',
    type: String,
    nullable: true,
  })
  nextCursor: string | null;
}
