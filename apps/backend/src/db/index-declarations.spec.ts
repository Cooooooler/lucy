import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
// 副作用导入：实体装饰器在模块加载时注册列/索引元数据，下面的对照依赖它们
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity.js';
import { KnowledgeDocument } from '../knowledge/entities/knowledge-document.entity.js';
import { columnDefinitionsOf, KEYSET_INDEXES } from './keyset-indexes.js';

/**
 * keyset 索引的**可执行护栏**（把「注释里要求人工拒绝 migration:generate 的 ASC 提案」变成测试）。
 *
 * 起因：实体上的 `@Index` 只能表达 ASC，而 keyset 分页需要 `created_at DESC, id DESC` 的有序扫描，
 * 所以索引的排序方向只存在于迁移 DDL 里。此前只靠注释提醒人工审查——一次顺手接受生成结果，
 * 就会把有序扫描换成 ASC 索引（`IDX_knowledge_documents_kb_created` 当年就是这么被取代的）。
 *
 * 这里钉住两件事，期望值全部取自 `src/db/keyset-indexes.ts`（收敛迁移与 e2e 断言用的同一份）：
 * 1. 初始化迁移 DDL 里这三条索引的**列与方向**与规范定义逐列一致；
 * 2. 实体上的 `@Index` 仍声明了这些列（方向由 DDL 决定），避免实体侧被删/改名后两边脱节。
 *
 * 为什么必须比 DDL：收敛迁移在存量库上执行的正是这份 DDL 所描述的结构，它改歪时没有别的东西
 * 会变红。收敛迁移自己 import 规范定义，所以「DDL ↔ 规范」这一环就是它的护栏。
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

/** DDL 里的列定义 → 与 `columnDefinitionsOf` 同形的数组（`"created_at" DESC` → `created_at DESC`） */
function normalizeColumns(columns: string): string[] {
  return columns
    .split(',')
    .map((part) => part.replace(/"/g, '').replace(/\s+/g, ' ').trim());
}

/** 索引名 → 声明它的实体（用于比对实体侧的 @Index） */
const ENTITY_OF_INDEX: Record<string, object> = {
  IDX_knowledge_bases_owner_created_id: KnowledgeBase,
  IDX_knowledge_bases_visibility_created_id: KnowledgeBase,
  IDX_knowledge_documents_kb_created_id: KnowledgeDocument,
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
  it('初始化迁移的 DDL 与 keyset-indexes.ts 的规范定义逐列一致（拒绝 migration:generate 的 ASC 提案）', () => {
    const ddl = parseInitSchemaIndexes();

    for (const spec of KEYSET_INDEXES) {
      const declared = ddl.get(spec.name);
      expect(
        declared,
        `${spec.name} 没有在初始化迁移的 DDL 里找到：索引名被改名，或 DDL 写法变化让本护栏的解析落空`,
      ).toBeDefined();
      expect(
        declared?.table,
        `${spec.name} 在 DDL 里挂到了 ${declared?.table ?? '未知表'}，与规范定义的 ${spec.table} 不一致`,
      ).toBe(spec.table);
      expect(
        declared && normalizeColumns(declared.columns),
        `${spec.name} 的 DDL 变了：keyset 需要 created_at DESC, id DESC 的有序扫描，` +
          `若这是 migration:generate 提出的 ASC 版本，请拒绝并还原 DDL`,
      ).toEqual(columnDefinitionsOf(spec));
    }
  });

  it('实体 @Index 与规范定义声明的列一致（方向只能由 DDL 表达）', () => {
    for (const spec of KEYSET_INDEXES) {
      const entity = ENTITY_OF_INDEX[spec.name];
      expect(entity, `${spec.name} 没有登记实体`).toBeDefined();

      expect(
        entity && declaredIndexesOf(entity).get(spec.name),
        `实体上没有声明 ${spec.name}（或列不一致）：实体 @Index 与迁移 DDL 必须描述同一组列`,
      ).toEqual(spec.columns.map((column) => column.name));
    }
  });
});
