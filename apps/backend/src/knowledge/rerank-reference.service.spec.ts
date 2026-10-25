import type { EntityManager } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { RerankReferenceService } from './rerank-reference.service.js';

describe('RerankReferenceService', () => {
  const update = vi.fn();
  const getRepository = vi.fn(() => ({ update }));
  const manager = { getRepository } as unknown as EntityManager;
  const service = new RerankReferenceService();

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({ affected: 1 });
  });

  it('按模型 ID 清空重排引用（走实体仓库，以便刷新 updated_at）', async () => {
    await service.clearForModel(manager, 'm1');
    expect(getRepository).toHaveBeenCalledWith(KnowledgeBase);
    expect(update).toHaveBeenCalledWith(
      { rerankModelId: 'm1' },
      { rerankModelId: null },
    );
  });
});
