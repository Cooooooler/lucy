import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RerankReferencePort } from '../common/ports/rerank-reference.port.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';

@Injectable()
export class RerankReferenceService implements RerankReferencePort {
  /**
   * 用实体仓库而不是裸 SQL：表/列改名能被编译期发现，且 `repository.update`
   * 会刷新 `@UpdateDateColumn`，按 updatedAt 增量拉取的客户端不会漏掉这次变更。
   */
  async clearForModel(manager: EntityManager, modelId: string): Promise<void> {
    await manager
      .getRepository(KnowledgeBase)
      .update({ rerankModelId: modelId }, { rerankModelId: null });
  }
}
