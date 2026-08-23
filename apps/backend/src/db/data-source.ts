import { FileEntity } from '@coool/file-nest';
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
  entities: [__dirname + '/../**/*.entity{.ts,.js}', FileEntity],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
});
