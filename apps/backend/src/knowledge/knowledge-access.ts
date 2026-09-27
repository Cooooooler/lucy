import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';

/**
 * 知识库「解析 + 鉴权」的**唯一定义处**。
 *
 * 每个文档/知识库方法都要先按 id 取知识库、404 兜底、再按其可见性/属主鉴权——这三行样板
 * 若在各方法各写一份，任何一处漂移（例如把「不存在」改成 403、或漏掉判定）都不会被类型
 * 或测试统一拦住。这里把它收成两个函数，由 `KnowledgeService` 与 `KnowledgeDocumentService`
 * 共用。
 */

/** 解析知识库并要求**属主**：不存在 404，非属主 403。写操作（改/删/上传）用。 */
export async function resolveOwnedKb(
  kbRepo: Repository<KnowledgeBase>,
  kbId: string,
  userId: string,
): Promise<KnowledgeBase> {
  const kb = await kbRepo.findOne({ where: { id: kbId } });
  if (!kb) throw new NotFoundException('知识库不存在');
  assertOwner(kb, userId);
  return kb;
}

/** 解析知识库并要求**可读**：不存在 404，既非属主又非公开 403。读操作（详情/列表）用。 */
export async function resolveReadableKb(
  kbRepo: Repository<KnowledgeBase>,
  kbId: string,
  userId: string,
): Promise<KnowledgeBase> {
  const kb = await kbRepo.findOne({ where: { id: kbId } });
  if (!kb) throw new NotFoundException('知识库不存在');
  assertReadable(kb, userId);
  return kb;
}

/** 属主可读写；公开库任何人可读；其余拒绝。 */
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
