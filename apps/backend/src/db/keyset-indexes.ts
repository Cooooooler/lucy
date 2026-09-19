/**
 * keyset 索引的规范定义——**收敛侧的唯一来源**。
 *
 * 为什么单独成模块：这三条索引的形态（列序 + `DESC` 方向）此前在三个地方各写一份
 * （初始化迁移的 DDL、实体 `@Index`、存量库收敛迁移里的 DDL 字符串）。护栏测试只钉住了
 * 初始化迁移那份，**真正在存量库上执行重建的那份拷贝无人守护**——被改歪（漏 `DESC`、
 * 换列序）时测试照样全绿。现在收敛迁移与 e2e 断言都从这里取，初始化迁移的 DDL 仍是
 * 历史文件（不重写），由 `index-declarations.spec.ts` 逐列比对两者一致。
 *
 * 方向为什么必须是 `DESC`：游标谓词写成行比较 `(created_at, id) < (:cursorTs, :cursorId)`，
 * 只有 `created_at DESC, id DESC` 的索引才能把它变成一次有序扫描；`@Index` 装饰器只能表达
 * ASC，所以方向只能由迁移 DDL 承载。
 */

/** keyset 索引的单列：列名 + 是否降序 */
export interface KeysetIndexColumn {
  name: string;
  desc?: boolean;
}

/** keyset 索引的规范定义 */
export interface KeysetIndexSpec {
  name: string;
  table: string;
  columns: readonly KeysetIndexColumn[];
}

export const KEYSET_INDEXES: readonly KeysetIndexSpec[] = [
  {
    name: 'IDX_knowledge_bases_owner_created_id',
    table: 'knowledge_bases',
    columns: [
      { name: 'owner_id' },
      { name: 'created_at', desc: true },
      { name: 'id', desc: true },
    ],
  },
  {
    name: 'IDX_knowledge_bases_visibility_created_id',
    table: 'knowledge_bases',
    columns: [
      { name: 'visibility' },
      { name: 'created_at', desc: true },
      { name: 'id', desc: true },
    ],
  },
  {
    name: 'IDX_knowledge_documents_kb_created_id',
    table: 'knowledge_documents',
    columns: [
      { name: 'knowledge_base_id' },
      { name: 'created_at', desc: true },
      { name: 'id', desc: true },
    ],
  },
] as const;

/** 三条索引的名字（e2e 断言按它取期望集合，不再手抄字面量） */
export const KEYSET_INDEX_NAMES: readonly string[] = KEYSET_INDEXES.map(
  (spec) => spec.name,
);

/**
 * 期望的列定义，与 `pg_get_indexdef(indexrelid, n, true)` 的输出**同形**
 * （如 `['owner_id', 'created_at DESC', 'id DESC']`），供运行期比对实际索引形态。
 */
export function columnDefinitionsOf(spec: KeysetIndexSpec): string[] {
  return spec.columns.map((column) =>
    column.desc ? `${column.name} DESC` : column.name,
  );
}

/** 生成重建索引的 DDL；存量库补齐用 `concurrently = true`（不长时间阻塞写入） */
export function createIndexSql(
  spec: KeysetIndexSpec,
  concurrently = false,
): string {
  const columns = spec.columns
    .map((column) => `"${column.name}"${column.desc ? ' DESC' : ''}`)
    .join(', ');
  const mode = concurrently ? 'CONCURRENTLY ' : '';
  return `CREATE INDEX ${mode}IF NOT EXISTS "${spec.name}" ON "${spec.table}" (${columns})`;
}

/** 生成删除索引的 DDL（形态不符时先删再建；`concurrently` 同样是不阻塞写入） */
export function dropIndexSql(
  spec: KeysetIndexSpec,
  concurrently = false,
): string {
  const mode = concurrently ? 'CONCURRENTLY ' : '';
  return `DROP INDEX ${mode}IF EXISTS "${spec.name}"`;
}
