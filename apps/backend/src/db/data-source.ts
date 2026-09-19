import 'dotenv/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * CLI 专用 DataSource：仅供 typeorm 迁移命令（`migration:run/generate`，`-d src/db/data-source.ts`）使用，
 * 与运行时 Nest 应用的连接（AppModule 的 TypeOrmModule.forRootAsync）分离。
 * 顶部 dotenv/config 内联读取 apps/backend/.env。
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lucy',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
  /**
   * uuid 主键默认值用 `gen_random_uuid()`（PostgreSQL 13+ 内置），而不是 TypeORM 缺省
   * 的 `uuid_generate_v4()`——后者依赖 uuid-ossp 扩展。`installExtensions: false` 关掉
   * TypeORM 在每次建连后自动 `CREATE EXTENSION` 的行为：结构只由迁移负责，连接不该动 schema。
   * 这两个选项必须与 AppModule 的 TypeOrmModule 配置一致，否则 `migration:generate`
   * 产出的 DDL 与运行时实体不一致。
   */
  uuidExtension: 'pgcrypto',
  installExtensions: false,
  /**
   * 迁移由 `migration:generate` 从实体生成（见 AGENTS.md 的流程），事务模式用 TypeORM
   * 默认的 `all`：每个迁移自动包一层事务，生成出来的文件不需要再手工补 `transaction` 声明。
   *
   * 将来若真需要**裸跑**的迁移（`CREATE INDEX CONCURRENTLY`、分批回填），把这里改成
   * `migrationsTransactionMode: 'none'`，并在那些迁移上显式 `transaction = false`
   * ——`all` 下 TypeORM 会直接拒绝单迁移覆盖事务模式（ForbiddenTransactionModeOverrideError）。
   */
});
