import { instanceToPlain } from 'class-transformer';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { Conversation } from './ai/entities/conversation.entity.js';
import { Message } from './ai/entities/message.entity.js';
import { BackendFileEntity } from './knowledge/entities/backend-file.entity.js';
import { KnowledgeBase } from './knowledge/entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './knowledge/entities/knowledge-document.entity.js';
import { KnowledgeLike } from './knowledge/entities/knowledge-like.entity.js';
import { User } from './users/user.entity.js';

/**
 * 出站序列化契约（行为级，非文本扫描）。
 *
 * 全局 ClassSerializerInterceptor 是**排除式**白名单：它只剔除显式标注 `@Exclude()`
 * 的字段。而 `@ApiHideProperty()` 只作用于 Swagger 文档，对真实响应毫无作用——
 * 实体本身即对外契约时，任何漏标的敏感列/关系对象都会静默出网。
 * 这里用 class-transformer 真实跑一遍序列化，把「实体上不允许出网的字段」变成
 * 可执行约束：漏加 `@Exclude()` 会直接让本文件变红。
 *
 * 副作用导入：实体的装饰器在模块加载时把关系元数据注册进 TypeORM 存储，
 * 下面的断言依赖这些导入，勿删。
 */
const SENTINEL_HASH = 'SENTINEL_PASSWORD_HASH';

/** 全部实体：显式列出来既是为了注册元数据，也是防呆断言的输入 */
const ENTITY_CLASSES = [
  User,
  Conversation,
  Message,
  KnowledgeBase,
  KnowledgeDocument,
  BackendFileEntity,
  KnowledgeLike,
];

/** 哨兵 User：passwordHash 一旦出现在序列化结果里即被断言捕获 */
function sentinelUser(): User {
  return Object.assign(new User(), {
    id: 'sentinel-user-id',
    username: 'sentinel-user',
    passwordHash: SENTINEL_HASH,
  });
}

describe('出站序列化契约', () => {
  it('实体元数据已注册（防止下面的关系扫描空跑）', () => {
    const registered = new Set(
      getMetadataArgsStorage().tables.map((table) => table.target),
    );

    for (const entity of ENTITY_CLASSES) {
      expect(registered.has(entity), `${entity.name} 未注册`).toBe(true);
    }
  });

  it('User 序列化剔除 passwordHash', () => {
    const plain = instanceToPlain(sentinelUser());

    expect(plain).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(plain)).not.toContain(SENTINEL_HASH);
  });

  it('指向 User 的关系对象 populate 后不泄漏 passwordHash', () => {
    const relations = getMetadataArgsStorage().relations.filter((relation) => {
      const type = relation.type as unknown;
      return typeof type === 'function' && (type as () => unknown)() === User;
    });

    // 防呆：元数据收集失效（如实体未导入）时不能让本检查空跑
    expect(relations.length).toBeGreaterThan(0);

    for (const relation of relations) {
      const Target = relation.target as new () => object;
      const owner = new Target();
      (owner as Record<string, unknown>)[relation.propertyName] =
        sentinelUser();

      const plain = instanceToPlain(owner);
      // 两层断言，缺一不可：
      // 1) 关系对象本身必须被剔除——只断言 passwordHash 会被 User 自己的 @Exclude 兜住，
      //    漏标的关系会带着 username/email 等字段整体出网而不被发现；
      // 2) 万一嵌套对象仍被序列化，passwordHash 也不得出现。
      expect(
        plain,
        `${Target.name}.${relation.propertyName} 未标注 @Exclude()，populate 后会整体出网`,
      ).not.toHaveProperty(relation.propertyName);
      expect(
        JSON.stringify(plain),
        `${Target.name}.${relation.propertyName} 泄漏了 passwordHash`,
      ).not.toContain(SENTINEL_HASH);
    }
  });
});
