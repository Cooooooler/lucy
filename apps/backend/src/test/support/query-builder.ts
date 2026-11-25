import type { Mock } from 'vitest';

/**
 * QueryBuilder 测试桩的共享构造器。
 *
 * 各模块的 fixture 都会手搓「可链式 QueryBuilder」：一串 `vi.fn()` 再逐行
 * `mockReturnValue(qb)`，最后给终止方法（`getMany`/`execute`/…）配返回值。
 * 逐行连接既啰嗦，新增一个链式方法时还容易漏连。这里把两件重复的事收口：
 *
 * - `aliasStub`：`KeysetPaginator` 从 QueryBuilder 自身解析主别名与排序列名，
 *   所有 keyset 查询的桩都要提供同样形状的 `expressionMap.mainAlias`。
 * - `chainable`：把列出的方法都接成返回自身。
 *
 * 本目录（`src/test/**`）在 vitest 覆盖率配置里被排除，不计入门禁。
 */

/** 属性名转数据库列名（驼峰 → 下划线），与实体上的 `name:` 约定一致 */
function toColumnName(property: string): string {
  return property.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/** 主别名 + 实体元数据 stub：列名映射与实体上的 `name:` 一致 */
export function aliasStub(name: string) {
  return {
    name,
    hasMetadata: true,
    metadata: {
      name: `${name}Entity`,
      findColumnWithPropertyName: (property: string) => ({
        databaseName: toColumnName(property),
      }),
    },
  };
}

/** 让给定的方法都返回 QueryBuilder 自身，形成可链式调用的 mock */
export function chainable<T extends object>(
  qb: T,
  methods: readonly (keyof T)[],
): T {
  for (const method of methods) {
    (qb[method] as unknown as Mock).mockReturnValue(qb);
  }
  return qb;
}
