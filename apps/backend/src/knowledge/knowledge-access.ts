import { ForbiddenException } from '@nestjs/common';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';

/**
 * 知识库访问判定的**唯一定义处**（纯函数）：属主可读写；公开库任何人可读；其余拒绝。
 *
 * 抽出来由 `KnowledgeService`（知识库）与 `KnowledgeDocumentService`（文档）共用：
 * 文档的每个端点都要先解析并校验知识库可见性，两处各写一份判定必然漂移。
 */
export function assertOwner(kb: KnowledgeBase, userId: string): void {
  if (kb.ownerId !== userId) {
    throw new ForbiddenException('仅知识库属主可操作');
  }
}

export function assertReadable(kb: KnowledgeBase, userId: string): void {
  if (kb.ownerId === userId) return;
  if (kb.visibility === KnowledgeBaseVisibility.Public) return;
  throw new ForbiddenException('无权访问该知识库');
}
