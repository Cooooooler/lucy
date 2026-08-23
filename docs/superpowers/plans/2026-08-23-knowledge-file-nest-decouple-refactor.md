# Knowledge 后端解耦重构：@coool/file-nest 去 TypeORM，schema 归调用方

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development 逐任务实现，步骤用 `- [ ]` 跟踪。

**目标：** 让 `@coool/file-nest` 成为**纯存储层**（零 TypeORM、无 `files` 表、无实体），DB schema（含 `files.owner_id→users` 外键）全部归 backend 调用方。消除通用包与宿主模型的外键死结，同时让包真正通用、`migration:generate` 干净。

**背景/决策记录：** 原设计把 `FileEntity`（TypeORM 实体→`files` 表）放进包内，导致包无法建模宿主 `User` 关系、`owner_id→users` 外键与实体漂移、generate 反复想 DROP。用户定夺：包只做存储与字节处理，schema（含属主 FK）归调用方。同时保留 item①：multer 上传 10MB 硬顶为 DoS 安全上限，`FILE_MAX_SIZE` 为服务次级校验，有效上限为两者较小值，文档说明。

---

## 文件结构（相对 `2026-08-23-knowledge-base-backend.md` 的改动）

### packages/file-nest（改，存储化）

- 删：`src/file.entity.ts`
- 改：`src/file.service.ts` —— 无 `@InjectRepository`/实体；`save({buffer,ext,mime})→Promise<StoredFile>`（写存储、算 key/size/hash）；`read(key)`；`remove(key)`；取消 `findById`、取消 `SaveFileInput`（改用 `StoredFile` 类型）
- 改：`src/file.module.ts` —— 去掉 `TypeOrmModule.forFeature`，仅提供 `FILE_STORAGE`(StorageDriver)+`FileService`
- 改：`src/index.ts` —— 删 `FileEntity/SaveFileInput` 导出，改导 `StoredFile` 类型
- 删：`src/file.service.test.ts`、`src/file.module.test.ts`、`src/index.test.ts` 中依赖实体/Repository 的用例，改为纯存储/模块注入断言
- 改：`package.json` —— `peerDependencies` 去掉 `@nestjs/typeorm`/`typeorm`/`@nestjs/swagger`，devDependencies 同步；`dependencies` 仍空
- 改：`docs/guide/*`、`README.md` —— 更新为「纯存储、无 TypeORM、元数据由调用方持久化，ownerId 属主由调用方业务层校验」

### apps/backend（改，调用方拥有 schema）

- 新建：`src/knowledge/entities/backend-file.entity.ts` —— `@Entity('files')`，含 `ownerId`(`@ManyToOne(()=>User,{onDelete:'CASCADE'})`+`@JoinColumn({name:'owner_id'})`+`foreignKeyConstraintName:'FK_files_owner'`)、`originalName/ext/mime/size/key/hash/storage`、时间戳；表结构对齐原包 FileEntity + 属主关系 + `IDX_files_owner` 索引
- 改：`src/knowledge/knowledge.service.ts` —— 注入 `@InjectRepository(BackendFileEntity)`（`fileRepo`）；`addDocument` 用 `fileService.save({buffer,ext,mime})→StoredFile` 后 `fileRepo.save({ownerId,originalName,...stored})` 拿 `file.id`；`remove`/`removeDocument` 用 `fileRepo.findOneBy({id})` 取记录 → `fileService.remove(file.key)`（删字节）+ `fileRepo.delete({id})`（删元数据）；解析失败回滚同理（先 `fileService.remove(stored.key)` 再删 `fileRepo`）
- 改：`src/knowledge/knowledge.module.ts` —— `TypeOrmModule.forFeature([KnowledgeBase,KnowledgeDocument,BackendFileEntity])`
- 改：`src/db/data-source.ts` —— 移除 `import { FileEntity }` 与显式注册（包不再有实体；files 现由 backend 实体经 src glob 加载）
- 改：`src/main.ts` 或上传处 —— multer 10MB 补一句注释（item①，见任务 4）

### 迁移（改）

- 删：`src/db/migrations/1787868000000-DropFilesOwnerFk.ts`
- 改：`src/db/migrations/1787750000000-CreateKnowledgeTables.ts` —— `files` 表保留 `FK_files_owner→users CASCADE`（重新加回），其余不变；`knowledge_documents`/`knowledge_bases` 外键不变
- 验证：`migration:generate` 空跑应 "No changes found"

### 全局约束

- 全仓 ESM `.js`；`.env` 三项不变；`shared KNOWLEDGE_*` 不变
- `FileService`（包）签名：`save(input:{buffer:Buffer;ext:string;mime:string}):Promise<StoredFile>`；`StoredFile={key:string;ext:string;mime:string;size:number;hash:string;storage:string}`；`read(key):Promise<Buffer>`；`remove(key):Promise<void>`
- backend `BackendFileEntity` 的 `storage` 值来自 `StoredFile.storage`（`options.storage ?? 'local'`）

---

## 任务 1：@coool/file-nest 存储化（去 TypeORM）

**文件：** `packages/file-nest/src/{file.service.ts,file.module.ts,index.ts,options.ts,file.constants.ts}`；删 `file.entity.ts`；改 `file.service.test.ts`、`file.module.test.ts`、`index.test.ts`；改 `package.json`

- [ ] 改 `file.service.ts`：删 `@InjectRepository`/`Inject`/`Repository`/`FileEntity`，`SaveFileInput` 改为 `StoredFile`；`save({buffer,ext,mime})` → `{ key:\`${uuid}${ext}\`, ext, mime, size:buffer.length, hash:sha256, storage:options.storage??'local' }`，`storage.write(key,buffer)` 后返回；`read(key)`→`storage.read(key)`；`remove(key)`→`storage.delete(key)`；删除 `findById`/`repo`
- [ ] 改 `file.module.ts`：去掉 `TypeOrmModule` import 与 `forFeature`；providers 仍为 `FILE_MODULE_OPTIONS`/`FILE_STORAGE`(+resolveStorageDriver)/`FileService`；`exports:[FileService]`
- [ ] 改 `index.ts`：删 `export { FileEntity }`、`export type { SaveFileInput }`；改导 `export type { StoredFile }`
- [ ] 改 `file.service.test.ts`/`file.module.test.ts`/`index.test.ts`：去掉实体/Repository/overrideProvider 相关，改为断言 `save` 返回 `StoredFile` 且调用 `storage.write`、`remove` 委托 `storage.delete` 等纯逻辑；模块测试断言注入 `FILE_STORAGE` 为 `LocalStorageDriver`、`FileService` 可用
- [ ] 改 `package.json`：`peerDependencies` 仅 `@nestjs/common`/`@nestjs/core`；devDependencies 去掉 `@nestjs/typeorm`/`@nestjs/swagger`/`typeorm`
- [ ] 跑 `pnpm --filter @coool/file-nest build && test && typecheck` 全过

## 任务 2：backend 拥有 files 实体 + knowledge 模块改接

**文件：** 新建 `apps/backend/src/knowledge/entities/backend-file.entity.ts`；改 `knowledge.service.ts`、`knowledge.module.ts`

- [ ] 建 `backend-file.entity.ts`（`@Entity('files')`）：`id` uuid pk、`ownerId`(`@ManyToOne(()=>User,{onDelete:'CASCADE'})`+`@JoinColumn({name:'owner_id'})`+`foreignKeyConstraintName:'FK_files_owner'`+`@Index('IDX_files_owner')`)、`originalName`(`original_name` varchar255)、`ext` varchar20、`mime` varchar100、`size` int、`key` varchar255、`hash` char64、`storage` varchar20 default 'local'、`createdAt`/`updatedAt`
- [ ] 改 `knowledge.service.ts`：注入 `@InjectRepository(BackendFileEntity) fileRepo`；`remove`(第111-112)、`removeDocument`(第243-244)、`addDocument`(第155/168) 改为「`fileService.save`→`fileRepo.save`」「`fileRepo.findOneBy`→`fileService.remove(key)`+`fileRepo.delete(id)`」流程
- [ ] 改 `knowledge.module.ts`：`forFeature([KnowledgeBase,KnowledgeDocument,BackendFileEntity])`
- [ ] 跑 `pnpm --filter @lucy/backend test src/knowledge && typecheck`

## 任务 3：迁移加回属主 FK + 去 DropFilesOwnerFk + data-source 清理

**文件：** 改 `src/db/migrations/1787750000000-CreateKnowledgeTables.ts`（把 `FK_files_owner` 加回 files 表）；删 `src/db/migrations/1787868000000-DropFilesOwnerFk.ts`；改 `src/db/data-source.ts`（移除 `FileEntity` import 与显式注册）

- [ ] `CreateKnowledgeTables`：`files` 建表后加 `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`；down 里对应 `DROP CONSTRAINT "FK_files_owner"`
- [ ] 删 `DropFilesOwnerFk.ts`
- [ ] `data-source.ts`：去掉 `import { FileEntity } from '@coool/file-nest'` 与 entities 数组里的 `FileEntity`
- [ ] 跑 `pnpm --filter @lucy/backend exec tsx ./node_modules/typeorm/cli.js migration:run -d src/db/data-source.ts`；确认无 `FK_files_owner` 缺失报错；`migration:generate` 空跑应 "No changes found"（临时文件生成后丢弃，不得提交）

## 任务 4：multer 说明 + file-nest 文档（item① + 重构说明）

**文件：** 改 `apps/backend/src/knowledge/knowledge.controller.ts`（上传处注释）；改 `packages/file-nest/README.md`、`docs/guide/{getting-started,file-service}.md`

- [ ] `knowledge.controller.ts`：`FileInterceptor('file',{limits:{fileSize:10*1024*1024}})` 旁加注释：10MB 硬顶为 DoS 安全上限，`FILE_MAX_SIZE` 为服务次级校验，有效上限为两者较小值
- [ ] file-nest 文档：说明包为「纯存储层、无 TypeORM；文件元数据与属主关系由调用方持久化，ownerId 属主校验由调用方业务层承担」

## 任务 5：全量回归

- [ ] `pnpm typegen`；`pnpm --filter @coool/file-nest build && test && typecheck`；`pnpm --filter @lucy/shared build`；`pnpm --filter @lucy/backend build && test && typecheck && lint`；`pnpm build && test && typecheck`
- [ ] `migration:generate` 空跑 "No changes found"（临时丢弃）
- [ ] 复核：`files` 表含 `FK_files_owner`、三表+外键在库存在

---

## 自检

- **规格覆盖**：包去 TypeORM✅、backend 拥有 files 实体+FK✅、迁移加回 FK✅、data-source 清理✅、multer 说明✅、文档✅、全量回归✅
- **占位符**：无 TODO
- **一致性**：包 `StoredFile` 字段与 backend `fileRepo.save`/`fileRepo.findOneBy` 用法一致（key/ext/mime/size/hash/storage、id）；`fileService.remove(file.key)` 而非实体

## 执行交接

两种执行方式：1) 子代理驱动（推荐）；2) 内联 executing-plans。
