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
   * 迁移不由 TypeORM 自动包事务，允许单个迁移自行决定是否开事务：
   * - `transaction = false`（如分批回填、`CREATE INDEX CONCURRENTLY` 这类必须在事务外
   *   执行的迁移）：每条语句自动提交，避免长事务持锁、避免 CONCURRENTLY 落入事务块而报
   *   “cannot run inside a transaction block”/“无法在事务块中运行”。
   * - `transaction = true`：需要原子性的迁移请显式声明，TypeORM 会为其单独开事务。
   *
   * 因为 `none` 下「不声明」就等于「非原子」，约定**每个迁移都必须显式声明**，
   * 避免原子性被静默降级。
   *
   * 注意必须用 `none`（而非 `each`）：TypeORM 的 `migration:revert` **只**看全局模式，
   * 会无视单个迁移的 `transaction = false`，强行包一层事务——那样 `down()` 里的
   * `DROP INDEX CONCURRENTLY` 必失败。`up` 路径下全局默认本就等价于 `false`。
   * 全局 `all`（默认值）则直接禁止任何单迁移覆盖事务模式
   * （ForbiddenTransactionModeOverrideError）。
   */
  migrationsTransactionMode: 'none',
});
