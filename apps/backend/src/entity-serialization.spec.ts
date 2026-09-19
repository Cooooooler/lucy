/// <reference types="vite/client" />
import { instanceToPlain } from 'class-transformer';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
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
 * 实体清单本身也是**自动发现**的（`import.meta.glob` 扫 `**\/*.entity.ts` + TypeORM 表元数据过滤）：
 * 手工维护名单时新增实体文件不会被任何断言覆盖，等于护栏空转。
 */
const SENTINEL = 'SENTINEL_OUTBOUND_VALUE';

/** 实体类（构造无参；实例字段按元数据填充） */
type EntityClass = new () => object;

/** 自动发现全部实体模块：新增实体文件若未登记进白名单，本文件会变红 */
const ENTITY_MODULES = import.meta.glob<Record<string, unknown>>(
  './**/*.entity.ts',
  { eager: true },
);

/** 从模块导出里挑出「被 TypeORM 登记为表」的类 = 实体 */
function discoverEntityClasses(): EntityClass[] {
  const tables = new Set(
    getMetadataArgsStorage().tables.map((table) => table.target),
  );
  const discovered = new Map<string, EntityClass>();
  for (const module of Object.values(ENTITY_MODULES)) {
    for (const exported of Object.values(module)) {
      if (typeof exported === 'function' && tables.has(exported)) {
        discovered.set(exported.name, exported as EntityClass);
      }
    }
  }
  return [...discovered.values()];
}

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
  const entityClasses = discoverEntityClasses();

  it('实体元数据已注册（防止下面的字段扫描空跑）', () => {
    // 自动发现本身要先可信：扫到的模块非空、每个实体都能扫到列/关系
    expect(Object.keys(ENTITY_MODULES).length).toBeGreaterThan(0);
    expect(entityClasses.length).toBeGreaterThan(0);

    for (const entity of entityClasses) {
      expect(
        persistedFieldsOf(entity).length,
        `${entity.name} 扫不到任何列/关系`,
      ).toBeGreaterThan(0);
    }
  });

  it('每个实体都有出网白名单（新增实体必须显式登记）', () => {
    // 双向对齐：白名单缺新实体 → 红；白名单里写了不存在的实体 → 也红
    expect(Object.keys(ALLOWED_OUTBOUND_KEYS).sort()).toEqual(
      entityClasses.map((entity) => entity.name).sort(),
    );
  });

  it('实体出网字段集与白名单一致（新增列/关系必须显式决定）', () => {
    for (const Entity of entityClasses) {
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
