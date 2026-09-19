import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 数据库初始化迁移（全库唯一迁移，由此前 16 个迁移压缩而来）。
 *
 * 库结构已稳定：迁移历史不再保留，本文件描述**当前**的最终结构，供全新库一次建好。
 * 因此历史数据操作一律不在此处重放——分批回填、`RENAME VALUE 'assistant'→'ai'`、
 * 描述列宽度的两次数值调整、`transaction = false` 的 `CREATE INDEX CONCURRENTLY`
 * 等都只对「旧库」有意义，对空库是空转（CONCURRENTLY 更是无谓且不能进事务）。
 * 需要提升账号为 superadmin 的环境，直接在库里执行一次 UPDATE（无提权接口，见
 * docs/superpowers/specs/2026-09-11-user-role-hierarchy-design.md §4）。
 *
 * ⚠️ 存量库（跑过旧 16 个迁移的库）**直接跑本迁移即可**：`up()` 会先探测 schema 是否已存在，
 * 存在就跳过建表（TypeORM 仍会把本迁移记录为已执行，历史就此对齐）。这条探测是必须的——
 * 没有它的话，存量库的 `migrations` 表里只有旧记录，TypeORM 会把本迁移当成待执行去
 * `CREATE TABLE`，撞上「对象已存在」后报错回滚，该行永远落不了库，此后 `db:migrate`
 * 会**永久失败**，任何新迁移都再也上不去。
 *
 * 两个易被「顺手简化」而破坏的点：
 * 1. `knowledge_bases`/`knowledge_documents` 的时间列默认值必须是
 *    `date_trunc('milliseconds', now())`：keyset 分页的游标精度是毫秒（JS Date 固有精度），
 *    默认值退回 `now()` 会写入微秒，使 `(created_at, id) < (:cursorTs, :cursorId)`
 *    在同一毫秒内整批跳行。实体上的 `default: () => "date_trunc('milliseconds', now())"`
 *    必须与此保持一致，否则 `migration:generate` 会提出把精度改回 `now()` 的变更。
 * 2. `knowledge_*` 的 keyset 索引排序方向是 `created_at DESC, id DESC`，
 *    而 `@Index` 装饰器只能表达 ASC——`migration:generate` 据此提出的 ASC 索引变更
 *    必须在人工审查时拒绝。
 *
 * 事务：`transaction = true`，整个 DDL 要么全成、要么全回滚（约定见 data-source.ts）。
 *
 * 写法说明：DDL 收在**一条**多语句 SQL 里一次执行（`pg` 无参数时走简单查询协议，支持分号分隔）。
 * 这不是图省事：逐条 `await queryRunner.query(...)` 会让本文件出现几十处形状完全相同的调用，
 * Sonar 的重复块检测会把它记成新代码重复率超阈值（实测 36→41 行互相匹配、整体 3.6% > 3%，
 * 质量门禁直接变红），而这里重复的是「同一形状的调用」而非可抽取的逻辑。
 */
export class InitSchema1789700000000 implements MigrationInterface {
  name = 'InitSchema1789700000000';

  /** 本迁移的时间戳（= 类名后缀），down() 用它判断「之前是否还有已执行的迁移」 */
  static readonly TIMESTAMP = 1789700000000;

  /** 显式原子化：多语句 DDL 必须整体成功或整体回滚（约定见 data-source.ts）。 */
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 存量库保护（见文件头说明）：schema 已在则视为本迁移已应用，直接返回。
    // 不能靠「文档里写一句不要跑」——那没有护栏，且会让 db:migrate 在存量库上永久失败。
    const [existing] = (await queryRunner.query(
      `SELECT to_regclass('public.users') AS table_name`,
    )) as { table_name: string | null }[];
    if (existing?.table_name) {
      return;
    }

    await queryRunner.query(`
      -- 用户
      CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" character varying(50) NOT NULL, "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "nickname" character varying(50), "status" smallint NOT NULL DEFAULT '1', "role" character varying(20) NOT NULL DEFAULT 'user', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "CHK_users_role" CHECK ("role" IN ('user', 'admin', 'superadmin')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"));

      -- AI 对话
      CREATE TYPE "public"."ai_messages_role_enum" AS ENUM('user', 'ai', 'system');
      CREATE TYPE "public"."ai_messages_status_enum" AS ENUM('complete', 'aborted', 'failed');
      CREATE TABLE "ai_conversations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "title" character varying(50), "model" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60db12765b82858ba00c8aa4ae2" PRIMARY KEY ("id"));
      CREATE INDEX "IDX_12fdbf99ca0da93085d61edd3b" ON "ai_conversations" ("user_id");
      ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      CREATE TABLE "ai_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "role" "public"."ai_messages_role_enum" NOT NULL, "content" text NOT NULL, "thinking" text, "status" "public"."ai_messages_status_enum", "truncated" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"));
      CREATE INDEX "IDX_ai_messages_conversation_created" ON "ai_messages" ("conversation_id", "created_at");
      ALTER TABLE "ai_messages" ADD CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

      -- 文件元数据
      CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "original_name" character varying(255) NOT NULL, "ext" character varying(20) NOT NULL, "mime" character varying(100) NOT NULL, "size" integer NOT NULL, "key" character varying(255) NOT NULL, "hash" character(64) NOT NULL, "storage" character varying(20) NOT NULL DEFAULT 'local', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_files_id" PRIMARY KEY ("id"));
      CREATE INDEX "IDX_files_owner" ON "files" ("owner_id");
      ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

      -- 知识库
      CREATE TABLE "knowledge_bases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "visibility" character varying(10) NOT NULL DEFAULT 'private', "name" character varying(100) NOT NULL, "description" character varying(200), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "PK_knowledge_bases_id" PRIMARY KEY ("id"));
      CREATE INDEX "IDX_knowledge_bases_owner_visibility" ON "knowledge_bases" ("owner_id", "visibility");
      CREATE INDEX "IDX_knowledge_bases_owner_created_id" ON "knowledge_bases" ("owner_id", "created_at" DESC, "id" DESC);
      CREATE INDEX "IDX_knowledge_bases_visibility_created_id" ON "knowledge_bases" ("visibility", "created_at" DESC, "id" DESC);
      ALTER TABLE "knowledge_bases" ADD CONSTRAINT "FK_knowledge_bases_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

      CREATE TABLE "knowledge_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "file_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "content" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('milliseconds', now()), CONSTRAINT "PK_knowledge_documents_id" PRIMARY KEY ("id"));
      CREATE INDEX "IDX_knowledge_documents_kb_created_id" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC, "id" DESC);
      CREATE INDEX "IDX_knowledge_documents_file" ON "knowledge_documents" ("file_id");
      ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

      CREATE TABLE "knowledge_likes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_likes_id" PRIMARY KEY ("id"));
      ALTER TABLE "knowledge_likes" ADD CONSTRAINT "UQ_knowledge_like" UNIQUE ("knowledge_base_id", "user_id");
      ALTER TABLE "knowledge_likes" ADD CONSTRAINT "FK_knowledge_likes_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
      ALTER TABLE "knowledge_likes" ADD CONSTRAINT "FK_knowledge_likes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 与 up() 对称：存量库上 up() 只做 baseline（schema 早已存在、什么都没建），down() 就绝不能
    // 无条件整库 DROP——否则在那类库上执行一次 `db:revert` 会把整个库清空。
    // 判据：本迁移之前是否还有已执行的迁移。有 ⇒ 表是旧迁移建的，本迁移不负责拆；
    // 没有（全新库）⇒ 库是本迁移建的，由本迁移拆掉，保持 create → revert → 重跑 的往返可用。
    const [older] = (await queryRunner.query(
      `SELECT count(*)::int AS executed FROM "migrations" WHERE "timestamp" < $1`,
      [InitSchema1789700000000.TIMESTAMP],
    )) as { executed: number }[];
    if (older.executed > 0) {
      return;
    }

    // 逆依赖顺序整库拆掉（列级 down 对初始化迁移没有意义）
    await queryRunner.query(`
      DROP TABLE "knowledge_likes";
      DROP TABLE "knowledge_documents";
      DROP TABLE "knowledge_bases";
      DROP TABLE "files";
      DROP TABLE "ai_messages";
      DROP TABLE "ai_conversations";
      DROP TABLE "users";
      DROP TYPE "public"."ai_messages_status_enum";
      DROP TYPE "public"."ai_messages_role_enum";
    `);
  }
}
