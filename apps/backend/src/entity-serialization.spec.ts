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
 * 的字段。而 `@ApiHideProperty()` 在本版本的 @nestjs/swagger 里是个空装饰器
 * （`(target, propertyKey) => {}`，只影响 Swagger 的 schema 生成），对真实响应毫无作用——
 * 实体若被当契约返回，任何漏标的敏感列/关系对象都会静默出网。
 *
 * 因此这里用 class-transformer 真实跑一遍序列化，把「实体上允许出网的字段」逐个实体
 * **显式登记**成白名单：新增列/关系、去掉某个 `@Exclude()` 都会让本文件变红，
 * 迫使做出明确决定——内部字段加 `@Exclude()`，对外字段登记进白名单。
 *
 * 副作用导入：实体的装饰器在模块加载时把列/关系元数据注册进 TypeORM 存储，
 * 下面的断言依赖这些导入，勿删。
 */
const SENTINEL = 'SENTINEL_OUTBOUND_VALUE';

/** 实体类（构造无参；实例字段按元数据填充） */
type EntityClass = new () => object;

/** 全部实体：显式列出来既是为了注册元数据，也是白名单覆盖度的判据 */
const ENTITY_CLASSES: EntityClass[] = [
  User,
  Conversation,
  Message,
  KnowledgeBase,
  KnowledgeDocument,
  BackendFileEntity,
  KnowledgeLike,
];

/**
 * 每个实体**允许出网**的字段集（= 该实体被返回时允许出现的键）。
 * 登记原则：只有确实属于对外契约的字段才写进来；内部字段一律在实体上加 `@Exclude()`。
 */
const ALLOWED_OUTBOUND_KEYS: Record<string, readonly string[]> = {
  User: [
    'id',
    'username',
    'email',
    'nickname',
    'status',
    'role',
    'createdAt',
    'updatedAt',
  ],
  Conversation: [
    'id',
    'userId',
    'title',
    'model',
    'messages',
    'createdAt',
    'updatedAt',
  ],
  Message: [
    'id',
    'conversationId',
    'role',
    'content',
    'thinking',
    'status',
    'truncated',
    'createdAt',
  ],
  BackendFileEntity: [
    'id',
    'ownerId',
    'originalName',
    'ext',
    'mime',
    'size',
    'storage',
    'createdAt',
    'updatedAt',
  ],
  KnowledgeBase: [
    'id',
    'ownerId',
    'visibility',
    'name',
    'description',
    'createdAt',
    'updatedAt',
    'likeCount',
    'isLiked',
  ],
  KnowledgeDocument: [
    'id',
    'knowledgeBaseId',
    'fileId',
    'title',
    'content',
    'createdAt',
    'updatedAt',
  ],
  // 纯内部表：点赞对外只有 { likeCount, isLiked } 聚合结果，实体本身一个字段都不出网
  KnowledgeLike: [],
};

/** 查询期回写的视图字段：不在 TypeORM 元数据里，需单独填充才能被快照断言看到 */
const VIEW_FIELDS: Record<string, readonly string[]> = {
  KnowledgeBase: ['likeCount', 'isLiked'],
};

/** 从 TypeORM 元数据取实体的持久化字段名（列 + 关系） */
function persistedFieldsOf(Entity: EntityClass): string[] {
  const storage = getMetadataArgsStorage();
  return [
    ...storage.columns
      .filter((column) => column.target === Entity)
      .map((column) => column.propertyName),
    ...storage.relations
      .filter((relation) => relation.target === Entity)
      .map((relation) => relation.propertyName),
  ];
}

/** 哨兵 User：passwordHash 一旦出现在序列化结果里即被断言捕获 */
function sentinelUser(): User {
  return Object.assign(new User(), {
    id: 'sentinel-user-id',
    username: 'sentinel-user',
    passwordHash: SENTINEL,
  });
}

describe('出站序列化契约', () => {
  it('实体元数据已注册（防止下面的字段扫描空跑）', () => {
    const registered = new Set(
      getMetadataArgsStorage().tables.map((table) => table.target),
    );

    for (const entity of ENTITY_CLASSES) {
      expect(registered.has(entity), `${entity.name} 未注册`).toBe(true);
      expect(
        persistedFieldsOf(entity).length,
        `${entity.name} 扫不到任何列/关系`,
      ).toBeGreaterThan(0);
    }
  });

  it('每个实体都有出网白名单（新增实体必须显式登记）', () => {
    expect(Object.keys(ALLOWED_OUTBOUND_KEYS).sort()).toEqual(
      ENTITY_CLASSES.map((entity) => entity.name).sort(),
    );
  });

  it('实体出网字段集与白名单一致（新增列/关系必须显式决定）', () => {
    for (const Entity of ENTITY_CLASSES) {
      const instance = new Entity() as unknown as Record<string, unknown>;
      for (const field of persistedFieldsOf(Entity)) instance[field] = SENTINEL;
      for (const field of VIEW_FIELDS[Entity.name] ?? []) {
        instance[field] = SENTINEL;
      }

      expect(
        Object.keys(instanceToPlain(instance)).sort(),
        `${Entity.name} 的出网字段集变了：内部字段请加 @Exclude()，对外字段请登记进 ALLOWED_OUTBOUND_KEYS`,
      ).toEqual([...(ALLOWED_OUTBOUND_KEYS[Entity.name] ?? [])].sort());
    }
  });

  it('User 序列化剔除 passwordHash', () => {
    const plain = instanceToPlain(sentinelUser());

    expect(plain).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(plain)).not.toContain(SENTINEL);
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
      ).not.toContain(SENTINEL);
    }
  });
});
