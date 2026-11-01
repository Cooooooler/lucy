import { readFileSync, readdirSync } from 'node:fs';
import { NORMALIZE_EMAIL_TRIM_CHARS } from '../db/migrations/1793491200000-NormalizeUserEmailCase.js';
import {
  EMAIL_TRIM_CHARS_SQL,
  USER_EMAIL_NORMALIZED_CHECK,
} from './user-email.constraint.js';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);

/** 最新一条 CHECK 迁移（文件名带时间戳，按名排序即时间序） */
function latestCheckMigrationFile(): string {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.includes('AddUserEmailNormalizedCheck'))
    .sort()
    .at(-1);
  if (!file) throw new Error('未找到 AddUserEmailNormalizedCheck 迁移');
  return file;
}

describe('users.email 的 schema 约束', () => {
  it('CHECK 表达式使用完整的归一空白字符集', () => {
    expect(USER_EMAIL_NORMALIZED_CHECK).toBe(
      `"email" = btrim(lower("email"), E'${EMAIL_TRIM_CHARS_SQL}')`,
    );
  });

  it('归一迁移内联的字符集与运行时常量一致', () => {
    expect(NORMALIZE_EMAIL_TRIM_CHARS).toBe(EMAIL_TRIM_CHARS_SQL);
  });

  // 真正进库的是 CHECK 迁移里的 DDL，而不是实体上的模板字符串：
  // 只断言实体模板等于自身是恒为真的，必须核对迁移文件的实际字面量。
  it('CHECK 迁移的真实 DDL 与运行时字符集一致', () => {
    const sql = readFileSync(
      new URL(latestCheckMigrationFile(), MIGRATIONS_DIR),
      'utf8',
    );
    // 迁移源码里的 E'' 反斜杠是双写的：把运行时单反斜杠再转义一次后比对
    const escaped = EMAIL_TRIM_CHARS_SQL.replaceAll('\\', '\\\\');
    expect(sql).toContain(`E'${escaped}'`);
  });
});
