import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { makeKb } from '../test/knowledge.fixtures.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { resolveOwnedKb, resolveReadableKb } from './knowledge-access.js';

/**
 * 访问判定的**唯一实现**在此直接覆盖：不存在 404 / 非属主 403 / 公开库可读。
 * 两个 service spec 只负责断言「确实走了这组助手」（以及副作用未被触发），
 * 判定矩阵本身改一处文案不会散落在多个 spec 里。
 */
const repo = (kb: KnowledgeBase | null) =>
  ({
    findOne: vi.fn().mockResolvedValue(kb),
  }) as unknown as Repository<KnowledgeBase>;

const owner = makeKb({ ownerId: 'u1' });
const otherPrivate = makeKb({
  ownerId: 'u2',
  visibility: KnowledgeBaseVisibility.Private,
});
const otherPublic = makeKb({
  ownerId: 'u2',
  visibility: KnowledgeBaseVisibility.Public,
});

describe('knowledge-access', () => {
  describe('resolveOwnedKb（写操作）', () => {
    it('知识库不存在 → 404', async () => {
      await expect(
        resolveOwnedKb(repo(null), 'kb1', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('非属主 → 403（私有库与公开库一视同仁：写操作只认属主）', async () => {
      await expect(
        resolveOwnedKb(repo(otherPrivate), 'kb1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        resolveOwnedKb(repo(otherPublic), 'kb1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('属主 → 返回解析到的实体', async () => {
      await expect(resolveOwnedKb(repo(owner), 'kb1', 'u1')).resolves.toBe(
        owner,
      );
    });
  });

  describe('resolveReadableKb（读操作）', () => {
    it('知识库不存在 → 404', async () => {
      await expect(
        resolveReadableKb(repo(null), 'kb1', 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('私有库非属主 → 403', async () => {
      await expect(
        resolveReadableKb(repo(otherPrivate), 'kb1', 'u1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('公开库非属主 → 可读', async () => {
      await expect(
        resolveReadableKb(repo(otherPublic), 'kb1', 'u1'),
      ).resolves.toBe(otherPublic);
    });

    it('属主 → 可读', async () => {
      await expect(resolveReadableKb(repo(owner), 'kb1', 'u1')).resolves.toBe(
        owner,
      );
    });
  });
});
