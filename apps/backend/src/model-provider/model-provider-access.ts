import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ModelProvider } from './entities/model-provider.entity.js';

/**
 * 解析模型供应商并要求**属主**：把 owner 直接写进 where 条件。
 *
 * 不存在与非属主统一 404（不像知识库那样区分 403）：模型配置按属主私有且携带凭证，
 * 区分 403/404 会给「某 id 是否存在」提供一个探测面。
 */
export async function resolveOwnedModelProvider(
  repo: Repository<ModelProvider>,
  id: string,
  userId: string,
): Promise<ModelProvider> {
  const provider = await repo.findOne({ where: { id, ownerId: userId } });
  if (!provider) throw new NotFoundException('模型不存在');
  return provider;
}
