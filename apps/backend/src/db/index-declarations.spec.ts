import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
// 副作用导入：实体装饰器在模块加载时注册列/索引元数据，下面的对照依赖它们
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity.js';

/**
 * keyset 索引的**可执行护栏**（把「注释里要求人工拒绝 migration:generate 的 ASC 提案」变成测试）。
 *
 * 起因：实体上的 `@Index` 只能表达 ASC，而 keyset 分页需要 `created_at DESC, id DESC` 的有序扫描，
 * 所以索引的排序方向只存在于迁移 DDL 里。此前只靠注释提醒人工审查——一次顺手接受生成结果，
 * 就会把有序扫描换成 ASC 索引（`IDX_knowledge_documents_kb_created` 当年就是这么被取代的）。
 *
 * 这里钉住两件事：
 * 1. 初始化迁移 DDL 里这三条索引的**列与方向**逐字不变；
 * 2. 实体上的 `@Index` 仍声明了这些列（方向由 DDL 决定），避免实体侧被删/改名后两边脱节。
 */
const INIT_SCHEMA_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
  '1789700000000-InitSchema.ts',
);

/** 初始化迁移 DDL 里声明的索引：索引名 → { 表, 列定义原文 } */
function parseInitSchemaIndexes(): Map<
  string,
  { table: string; columns: string }
> {
  const sql = readFileSync(INIT_SCHEMA_PATH, 'utf8');
  const indexes = new Map<string, { table: string; columns: string }>();
  for (const match of sql.matchAll(
    /CREATE INDEX "([^"]+)" ON "([^"]+)" \(([^)]+)\)/g,
  )) {
    indexes.set(match[1], { table: match[2], columns: match[3] });
  }
  return indexes;
}

/**
 * keyset 索引的期望形态（改这里 = 显式修改分页性能契约）。
 * 列的顺序与 `DESC` 方向都必须保持：游标谓词 `(created_at, id) < (:ts, :id)` 依赖它。
 */
const EXPECTED_KEYSET_INDEXES: Record<
  string,
  { table: string; entity: object; columns: string }
> = {
  IDX_knowledge_bases_owner_created_id: {
    table: 'knowledge_bases',
    entity: KnowledgeBase,
    columns: '"owner_id", "created_at" DESC, "id" DESC',
  },
  IDX_knowledge_bases_visibility_created_id: {
    table: 'knowledge_bases',
    entity: KnowledgeBase,
    columns: '"visibility", "created_at" DESC, "id" DESC',
  },
  IDX_knowledge_documents_kb_created_id: {
    table: 'knowledge_documents',
    entity: KnowledgeDocument,
    columns: '"knowledge_base_id", "created_at" DESC, "id" DESC',
  },
};

/** 实体的数据库列名映射：propertyName → 库里的列名 */
function columnNamesOf(Entity: object): Map<string, string> {
  return new Map(
    getMetadataArgsStorage()
      .columns.filter((column) => column.target === Entity)
      .map((column) => {
        const options = column.options as { name?: string } | undefined;
        return [column.propertyName, options?.name ?? column.propertyName];
      }),
  );
}

/** 实体 `@Index` 声明的索引：索引名 → 列（propertyName 解析成库列名，保持顺序） */
function declaredIndexesOf(Entity: object): Map<string, string[]> {
  const propertyToColumn = columnNamesOf(Entity);
  const indexes = new Map<string, string[]>();
  for (const index of getMetadataArgsStorage().indices) {
    if (index.target !== Entity || !index.name) continue;
    const columns = (index.columns ?? []) as string[];
    indexes.set(
      index.name,
      columns.map((column) => propertyToColumn.get(column) ?? column),
    );
  }
  return indexes;
}

describe('keyset 索引声明', () => {
  it('初始化迁移里的三条 keyset 索引仍是 DESC 形态（拒绝 migration:generate 的 ASC 提案）', () => {
    const ddl = parseInitSchemaIndexes();

    for (const [name, expected] of Object.entries(EXPECTED_KEYSET_INDEXES)) {
      expect(
        ddl.get(name),
        `${name} 的 DDL 变了：keyset 需要 created_at DESC, id DESC 的有序扫描，` +
          `若这是 migration:generate 提出的 ASC 版本，请拒绝并还原 DDL`,
      ).toMatchObject({ table: expected.table, columns: expected.columns });
    }
  });

  it('实体 @Index 与 DDL 声明的列一致（方向只能由 DDL 表达）', () => {
    const ddl = parseInitSchemaIndexes();

    for (const [name, expected] of Object.entries(EXPECTED_KEYSET_INDEXES)) {
      const ddlColumns = expected.columns.split(',').map((part) =>
        part
          .replace(/ DESC$/, '')
          .replace(/"/g, '')
          .trim(),
      );

      const declared = declaredIndexesOf(expected.entity);
      expect(
        declared.get(name),
        `实体上没有声明 ${name}（或列不一致）：实体 @Index 与迁移 DDL 必须描述同一组列`,
      ).toEqual(ddlColumns);
      // 防呆：DDL 里确实有这条索引，且表名与登记一致
      expect(ddl.get(name)?.table).toBe(expected.table);
    }
  });
});
