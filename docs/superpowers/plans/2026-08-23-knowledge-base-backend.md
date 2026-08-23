# 知识库后端实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现知识库后端：新建可复用包 `@coool/file-nest`（存储+元数据），并在 backend 新增 `knowledge` 模块（知识库→文档两级 CRUD + 文件上传解析 + 前后台权限）。

**架构：** 分层为三块——`packages/file-nest`（通用文件存储，零运行时依赖，可独立发布）；`packages/shared`（扩展错误码）；`apps/backend/src/knowledge`（业务：实体/DTO/权限/上传解析/CRUD）。

**技术栈：** NestJS 11 + TypeORM + Multer（`@nestjs/platform-express`）+ `file-type`/`pdf-parse`/`mammoth` + Vitest 4 + tsup（file-nest 双构建）+ VitePress（file-nest 文档）。

---

## 规格细化说明（相对 2026-08-23-knowledge-base-backend-design.md 的两处工程化调整）

1. **类型校验/解析从 file-nest 移到 knowledge 模块**：`file-nest` 是通用可发布包，保持零运行时依赖（仅 Nest/TypeORM peer）才能干净地出 `esm+cjs` 双构建；`file-type`/`pdf-parse`/`mammoth` 改为 backend 的依赖（backend 是纯 ESM，可安全用 ESM-only 的 `file-type`）。`file-nest` 的 `FileService` 只做 `save/read/remove/findById`（存储+元数据），不做格式白名单/解析。
2. **权限断言集中在 `KnowledgeService`**：新增 `assertOwner`/`assertReadable` 私有方法；非属主写一律 `KNOWLEDGE_FORBIDDEN`。

---

## 文件结构

### packages/file-nest（新建包，镜像 packages/redis）

- 创建：`packages/file-nest/package.json`
- 创建：`packages/file-nest/tsconfig.json`
- 创建：`packages/file-nest/tsconfig.build.json`
- 创建：`packages/file-nest/vitest.config.ts`
- 创建：`packages/file-nest/eslint.config.mjs`
- 创建：`packages/file-nest/README.md`
- 创建：`packages/file-nest/src/index.ts`
- 创建：`packages/file-nest/src/file.constants.ts`
- 创建：`packages/file-nest/src/options.ts`
- 创建：`packages/file-nest/src/file.entity.ts`
- 创建：`packages/file-nest/src/file.service.ts`
- 创建：`packages/file-nest/src/file.module.ts`
- 创建：`packages/file-nest/src/index.test.ts`
- 创建：`packages/file-nest/src/file.service.test.ts`
- 创建：`packages/file-nest/src/file.module.test.ts`
- 创建：`packages/file-nest/src/storage/storage-driver.interface.ts`
- 创建：`packages/file-nest/src/storage/local-storage.driver.ts`
- 创建：`packages/file-nest/src/storage/local-storage.driver.test.ts`
- 创建：`packages/file-nest/docs/.vitepress/config.ts`
- 创建：`packages/file-nest/docs/index.md`
- 创建：`packages/file-nest/docs/guide/getting-started.md`
- 创建：`packages/file-nest/docs/guide/configuration.md`
- 创建：`packages/file-nest/docs/guide/file-service.md`
- 创建：`packages/file-nest/docs/guide/storage-driver.md`

### packages/shared

- 修改：`packages/shared/src/index.ts`（ErrorCode 增加 KNOWLEDGE_* 常量）

### apps/backend

- 修改：`apps/backend/package.json`（新增 file-nest/file-type/pdf-parse/mammoth 依赖 + @types/multer devDep）
- 修改：`apps/backend/.env.example`（新增 FILE_STORAGE/FILE_MAX_SIZE/UPLOAD_DIR）
- 创建：`apps/backend/src/knowledge/entities/knowledge-base.entity.ts`
- 创建：`apps/backend/src/knowledge/entities/knowledge-document.entity.ts`
- 创建：`apps/backend/src/knowledge/dto/create-knowledge-base.dto.ts`
- 创建：`apps/backend/src/knowledge/dto/update-knowledge-base.dto.ts`
- 创建：`apps/backend/src/knowledge/dto/knowledge-list-query.dto.ts`
- 创建：`apps/backend/src/knowledge/dto/document-list-query.dto.ts`
- 创建：`apps/backend/src/knowledge/magic-bytes.ts`
- 创建：`apps/backend/src/knowledge/content-extractor.ts`
- 创建：`apps/backend/src/knowledge/magic-bytes.spec.ts`
- 创建：`apps/backend/src/knowledge/content-extractor.spec.ts`
- 创建：`apps/backend/src/knowledge/knowledge.service.ts`
- 创建：`apps/backend/src/knowledge/knowledge.service.spec.ts`
- 创建：`apps/backend/src/knowledge/knowledge.controller.ts`
- 创建：`apps/backend/src/knowledge/knowledge.controller.spec.ts`
- 创建：`apps/backend/src/knowledge/knowledge.module.ts`
- 修改：`apps/backend/src/app.module.ts`（引入 FileModule + KnowledgeModule）
- 创建：`apps/backend/src/db/migrations/1787750000000-CreateKnowledgeTables.ts`

---

## 任务 1：搭建 file-nest 包骨架

**文件：** 创建 `packages/file-nest/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`eslint.config.mjs`

- [ ] **步骤 1：写 package.json**

```json
{
  "name": "@coool/file-nest",
  "version": "0.1.0",
  "description": "NestJS file storage integration module: storage driver abstraction, metadata, DI",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./src/index.ts", "default": "./dist/index.js" },
      "require": { "types": "./src/index.ts", "default": "./dist/index.cjs" }
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --clean --dts --tsconfig tsconfig.build.json",
    "dev": "tsup src/index.ts --format esm,cjs --clean --dts --watch --tsconfig tsconfig.build.json",
    "docs:build": "vitepress build docs",
    "docs:dev": "vitepress dev docs",
    "lint": "eslint \"src/**/*.ts\" --fix",
    "prepublishOnly": "pnpm run build && pnpm run test",
    "test": "vitest run",
    "test:cov": "vitest run --coverage",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/typeorm": "^11.0.3",
    "@nestjs/swagger": "^11.4.6",
    "typeorm": "^1.1.0",
    "vitepress": "^1.6.4"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.1",
    "@nestjs/core": "^11.0.1",
    "@nestjs/typeorm": "^11.0.3",
    "typeorm": "^1.1.0"
  }
}
```

> 注：`@nestjs/swagger` 仅为 `FileEntity` 的 `@ApiProperty` 提供类型，故放 devDependencies（实体上的装饰器被 tsup dts 转换时实际运行不需要 swagger 运行时，仅类型）。

- [ ] **步骤 2：写 tsconfig.json / tsconfig.build.json / vitest.config.ts / eslint.config.mjs**

`packages/file-nest/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "esnext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src"]
}
```

`packages/file-nest/tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "ignoreDeprecations": "6.0" }
}
```

`packages/file-nest/vitest.config.ts`：

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/**/*.module.ts',
        '**/*.d.ts',
      ],
    },
  },
});
```

`packages/file-nest/eslint.config.mjs`（复制 packages/redis 的，含 docs 忽略）：

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '*.config.*', 'docs/**']),
  ...core,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...prettier,
]);
```

- [ ] **步骤 3：安装依赖**（根目录一次装齐，file-nest + backend 依赖）

```bash
pnpm add -D @nestjs/typeorm@^11.0.3 typeorm@^1.1.0 @nestjs/swagger@^11.4.6 vitepress@^1.6.4 --filter @coool/file-nest
pnpm add @coool/file-nest@workspace:* file-type@^21.0.0 pdf-parse@^1.1.1 mammoth@^1.8.0 --filter @lucy/backend
pnpm add -D @types/multer --filter @lucy/backend
```

- [ ] **步骤 4：跑一次占位校验确认包被 workspace 识别**

```bash
pnpm --filter @coool/file-nest typecheck
```

预期：因 `src` 尚空（或仅 index.ts），`tsc` 通过或仅提示无输入。可先创建 `src/index.ts` 占位（见任务 2 前）。

- [ ] **步骤 5：Commit**

```bash
git add packages/file-nest apps/backend/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(file-nest): 包骨架 + backend 引入依赖"
```

> 若 pnpm-workspace.yaml 无改动则不必 add；锁文件已含新增依赖。

---

## 任务 2：StorageDriver 接口 + LocalStorageDriver

**文件：** 创建 `packages/file-nest/src/storage/storage-driver.interface.ts`、`packages/file-nest/src/storage/local-storage.driver.ts`、`packages/file-nest/src/storage/local-storage.driver.test.ts`

- [ ] **步骤 1：写失败的测试**

`packages/file-nest/src/storage/local-storage.driver.test.ts`：

```ts
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './local-storage.driver.js';

describe('LocalStorageDriver', () => {
  let dir: string;
  let driver: LocalStorageDriver;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-nest-'));
    driver = new LocalStorageDriver({ dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write 后 read 能取回相同内容', async () => {
    await driver.write('a.txt', Buffer.from('hello'));
    expect(await driver.read('a.txt')).toEqual(Buffer.from('hello'));
  });

  it('write 自动创建目录', async () => {
    await driver.write('sub/b.txt', Buffer.from('x'));
    expect(await driver.read('sub/b.txt')).toEqual(Buffer.from('x'));
  });

  it('delete 删除文件，重复 delete 不抛错', async () => {
    await driver.write('c.txt', Buffer.from('y'));
    await driver.delete('c.txt');
    await expect(driver.read('c.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(driver.delete('c.txt')).resolves.toBeUndefined();
  });

  it('拒绝含 .. / \\ 的 key（防路径穿越）', async () => {
    await expect(
      driver.write('../evil.txt', Buffer.from('z')),
    ).rejects.toThrow();
    await expect(driver.write('a\\b.txt', Buffer.from('z'))).rejects.toThrow();
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @coool/file-nest test src/storage/local-storage.driver.test.ts
```

预期：失败（模块不存在）。

- [ ] **步骤 3：实现接口与驱动**

`packages/file-nest/src/storage/storage-driver.interface.ts`：

```ts
/** 存储驱动：按 key（相对路径）读写删除对象。key 为单层文件名（如 `uuid.pdf`）。 */
export interface StorageDriver {
  write(key: string, data: Buffer): Promise<void> | void;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void> | void;
}
```

`packages/file-nest/src/storage/local-storage.driver.ts`：

```ts
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StorageDriver } from './storage-driver.interface.js';

export interface LocalStorageDriverConfig {
  /** storage 根目录，默认 process.env.UPLOAD_DIR ?? 'uploads' */
  dir?: string;
}

/** 本地磁盘存储驱动：文件落在 `dir/<key>`，目录自动创建 */
export class LocalStorageDriver implements StorageDriver {
  private readonly dir: string;

  constructor(config: LocalStorageDriverConfig = {}) {
    this.dir = resolve(config.dir ?? process.env.UPLOAD_DIR ?? 'uploads');
  }

  private path(key: string): string {
    if (
      key.includes('/') ||
      key.includes('\\') ||
      key.includes('..') ||
      key.includes('..')
    ) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return join(this.dir, key);
  }

  async write(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => {});
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @coool/file-nest test src/storage/local-storage.driver.test.ts
```

预期：4 passed。

- [ ] **步骤 5：Commit**

```bash
git add packages/file-nest/src/storage
git commit -m "feat(file-nest): StorageDriver 接口 + LocalStorageDriver"
```

---

## 任务 3：FileEntity

**文件：** 创建 `packages/file-nest/src/file.entity.ts`

- [ ] **步骤 1：实现实体**

`packages/file-nest/src/file.entity.ts`：

```ts
import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 通用文件元数据，存储驱动无关键：文件对象交给 StorageDriver，此处只存描述信息 */
@Entity('files')
export class FileEntity {
  @ApiProperty({ description: '文件 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '文件属主用户 ID' })
  @Index()
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiProperty({ description: '原始文件名' })
  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @ApiProperty({ description: '扩展名（含点，如 .pdf）' })
  @Column({ type: 'varchar', length: 20 })
  ext: string;

  @ApiProperty({ description: 'MIME 类型' })
  @Column({ type: 'varchar', length: 100 })
  mime: string;

  @ApiProperty({ description: '文件大小（字节）' })
  @Column({ type: 'int' })
  size: number;

  @ApiProperty({ description: '存储相对路径 key' })
  @Column({ type: 'varchar', length: 255 })
  key: string;

  @ApiProperty({ description: 'SHA-256 校验和' })
  @Column({ type: 'char', length: 64 })
  hash: string;

  @ApiProperty({
    description: '存储驱动标识',
    default: 'local',
    enum: ['local', 's3'],
  })
  @Column({ type: 'varchar', length: 20, default: 'local' })
  storage: string;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

> 注：`Entity`/`Column` 等装饰器被 tsup `--dts` 产出类型时需要，故 `typeorm` 为 peer。实体不加 `@ManyToOne`（通用包不知道宿主应用的 `User`，FK 在宿主迁移中手工建）。

- [ ] **步骤 2：Commit**

```bash
git add packages/file-nest/src/file.entity.ts
git commit -m "feat(file-nest): FileEntity 元数据实体"
```

---

## 任务 4：FileService（save/read/remove/findById）

**文件：** 创建 `packages/file-nest/src/file.constants.ts`、`packages/file-nest/src/options.ts`、`packages/file-nest/src/file.service.ts`、`packages/file-nest/src/file.service.test.ts`

- [ ] **步骤 1：写失败的测试**

`packages/file-nest/src/file.service.test.ts`：

```ts
import { createHash } from 'node:crypto';
import { FileEntity } from './file.entity.js';
import { FileService, type SaveFileInput } from './file.service.js';

describe('FileService', () => {
  const repo = {
    create: vi.fn((x) => x),
    save: vi.fn(),
    findOneBy: vi.fn(),
    delete: vi.fn(),
  };
  const storage = {
    write: vi.fn(),
    read: vi.fn(),
    delete: vi.fn(),
  };
  const options = { storage: 'local' };
  let service: FileService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileService(repo as never, storage as never, options);
  });

  const input: SaveFileInput = {
    ownerId: 'u1',
    originalName: 'a.pdf',
    ext: '.pdf',
    mime: 'application/pdf',
    size: 8,
    buffer: Buffer.from('%PDF-1.4'),
  };

  it('save 写入存储并落元数据（含 sha256 与 key）', async () => {
    repo.save.mockResolvedValue(Object.assign(new FileEntity(), { id: 'f1' }));
    const file = await service.save(input);
    expect(storage.write).toHaveBeenCalledWith(
      expect.stringMatching(/^.+\.pdf$/),
      input.buffer,
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        originalName: 'a.pdf',
        ext: '.pdf',
        key: expect.any(String),
        hash: createHash('sha256').update(input.buffer).digest('hex'),
        storage: 'local',
      }),
    );
    expect(file.id).toBe('f1');
  });

  it('read 委托给存储并返回 Buffer', async () => {
    storage.read.mockResolvedValue(Buffer.from('raw'));
    const buf = await service.read({ key: 'f1.pdf' } as FileEntity);
    expect(storage.read).toHaveBeenCalledWith('f1.pdf');
    expect(buf).toEqual(Buffer.from('raw'));
  });

  it('remove 删除存储与元数据', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.remove({ id: 'f1', key: 'f1.pdf' } as FileEntity);
    expect(storage.delete).toHaveBeenCalledWith('f1.pdf');
    expect(repo.delete).toHaveBeenCalledWith({ id: 'f1' });
  });

  it('findById 返回实体或 null', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(service.findById('nope')).resolves.toBeNull();
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'nope' });
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @coool/file-nest test src/file.service.test.ts
```

- [ ] **步骤 3：实现**

`packages/file-nest/src/file.constants.ts`：

```ts
export const FILE_MODULE_OPTIONS = 'FILE_MODULE_OPTIONS';
export const FILE_STORAGE = 'FILE_STORAGE';
```

`packages/file-nest/src/options.ts`：

```ts
import type { ModuleMetadata } from '@nestjs/common';
import type { StorageDriver } from './storage/storage-driver.interface.js';

export interface FileModuleOptions {
  /** storage 根目录（LocalStorageDriver 用），默认 process.env.UPLOAD_DIR ?? 'uploads' */
  dir?: string;
  /** 存储驱动标识（写入 FileEntity.storage），默认 'local' */
  storage?: string;
  /** 注入自定义存储驱动；缺省用 LocalStorageDriver(dir) */
  driver?: StorageDriver;
}

export interface FileModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
  useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<FileModuleOptions> | FileModuleOptions;
}
```

`packages/file-nest/src/file.service.ts`：

```ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import { FileEntity } from './file.entity.js';
import type { FileModuleOptions } from './options.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

export interface SaveFileInput {
  ownerId: string;
  originalName: string;
  /** 含点，如 .pdf */
  ext: string;
  mime: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FileService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly repo: Repository<FileEntity>,
    @Inject(FILE_STORAGE)
    private readonly storage: StorageDriver,
    @Inject(FILE_MODULE_OPTIONS)
    private readonly options: FileModuleOptions,
  ) {}

  /** 写入对象存储 + 落元数据（key = `<uuid><ext>`，hash = sha256） */
  async save(input: SaveFileInput): Promise<FileEntity> {
    const id = randomUUID();
    const key = `${id}${input.ext}`;
    const hash = createHash('sha256').update(input.buffer).digest('hex');
    await this.storage.write(key, input.buffer);
    const entity = this.repo.create({
      id,
      ownerId: input.ownerId,
      originalName: input.originalName,
      ext: input.ext,
      mime: input.mime,
      size: input.size,
      key,
      hash,
      storage: this.options.storage ?? 'local',
    });
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<FileEntity | null> {
    return this.repo.findOneBy({ id });
  }

  async read(file: FileEntity): Promise<Buffer> {
    return this.storage.read(file.key);
  }

  async remove(file: FileEntity): Promise<void> {
    await this.storage.delete(file.key);
    await this.repo.delete({ id: file.id });
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @coool/file-nest test src/file.service.test.ts
```

预期：4 passed。

- [ ] **步骤 5：Commit**

```bash
git add packages/file-nest/src/file.constants.ts packages/file-nest/src/options.ts packages/file-nest/src/file.service.ts packages/file-nest/src/file.service.test.ts
git commit -m "feat(file-nest): FileService 存储与元数据门面"
```

---

## 任务 5：FileModule + index 导出

**文件：** 创建 `packages/file-nest/src/file.module.ts`、`packages/file-nest/src/index.ts`、`packages/file-nest/src/file.module.test.ts`、`packages/file-nest/src/index.test.ts`

- [ ] **步骤 1：写失败的测试**

`packages/file-nest/src/file.module.test.ts`：

```ts
import { Test } from '@nestjs/testing';
import { FileModule } from './file.module.js';
import { FileService } from './file.service.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import { FILE_STORAGE } from './file.constants.js';

describe('FileModule', () => {
  it('forRoot 提供默认 LocalStorageDriver 与 FileService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FileModule.forRoot({ dir: '/tmp/fs' })],
    })
      .overrideProvider('FileEntityRepository') // TypeORM 仓库在脱离 DB 时缺失
      .useValue({ create: (v) => v, save: (v) => v })
      .compile();
    const storage = moduleRef.get(FILE_STORAGE);
    expect(storage).toBeInstanceOf(LocalStorageDriver);
    const svc = moduleRef.get(FileService);
    expect(svc).toBeDefined();
  });

  it('forRootAsync 经 useFactory 解析配置', async () => {
    const fn = vi.fn(() => ({ dir: '/tmp/x', storage: 'local' }));
    const moduleRef = await Test.createTestingModule({
      imports: [FileModule.forRootAsync({ useFactory: fn })],
    })
      .overrideProvider('FileEntityRepository')
      .useValue({ create: (v) => v, save: (v) => v })
      .compile();
    expect(fn).toHaveBeenCalled();
    expect(moduleRef.get(FileService)).toBeDefined();
  });
});
```

> 说明：TypeORM `forFeature` 需要真实 DataSource；单测用 `overrideProvider` 顶掉 `getRepositoryToken(FileEntity)` 更稳。若 override 失败，改用 `provide: getRepositoryToken(FileEntity)`。实际以 `getRepositoryToken` 为准，见步骤 3 注。

`packages/file-nest/src/index.test.ts`：

```ts
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import * as pkg from './index.js';

describe('file-nest exports', () => {
  it('导出核心符号', () => {
    expect(pkg.FileModule).toBeDefined();
    expect(pkg.FileService).toBeDefined();
    expect(pkg.FileEntity).toBeDefined();
    expect(pkg.LocalStorageDriver).toBeDefined();
    expect(pkg.FILE_STORAGE).toBe(FILE_STORAGE);
    expect(pkg.FILE_MODULE_OPTIONS).toBe(FILE_MODULE_OPTIONS);
    expect(pkg.FILE_NEST_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @coool/file-nest test src/file.module.test.ts src/index.test.ts
```

- [ ] **步骤 3：实现**

`packages/file-nest/src/file.module.ts`：

```ts
import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
import { FileEntity } from './file.entity.js';
import { FileService } from './file.service.js';
import type { FileModuleAsyncOptions, FileModuleOptions } from './options.js';
import { LocalStorageDriver } from './storage/local-storage.driver.js';
import type { StorageDriver } from './storage/storage-driver.interface.js';

/** 解析存储驱动：优先注入的 driver，否则用 LocalStorageDriver(dir) */
export function resolveStorageDriver(opts: FileModuleOptions): StorageDriver {
  return opts.driver ?? new LocalStorageDriver({ dir: opts.dir });
}

@Module({})
export class FileModule {
  static forRoot(options: FileModuleOptions = {}): DynamicModule {
    return {
      module: FileModule,
      global: true,
      imports: [TypeOrmModule.forFeature([FileEntity])],
      providers: [
        { provide: FILE_MODULE_OPTIONS, useValue: options },
        { provide: FILE_STORAGE, useValue: resolveStorageDriver(options) },
        FileService,
      ],
      exports: [FileService],
    };
  }

  static forRootAsync(options: FileModuleAsyncOptions): DynamicModule {
    return {
      module: FileModule,
      global: true,
      imports: [
        TypeOrmModule.forFeature([FileEntity]),
        ...(options.imports ?? []),
      ],
      providers: [
        {
          provide: FILE_MODULE_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) =>
            (await options.useFactory(...args)) as FileModuleOptions,
        },
        {
          provide: FILE_STORAGE,
          inject: [FILE_MODULE_OPTIONS],
          useFactory: (opts: FileModuleOptions) => resolveStorageDriver(opts),
        },
        FileService,
      ],
      exports: [FileService],
    };
  }
}
```

`packages/file-nest/src/index.ts`：

```ts
export { FILE_MODULE_OPTIONS, FILE_STORAGE } from './file.constants.js';
export { FileEntity } from './file.entity.js';
export { FileModule, resolveStorageDriver } from './file.module.js';
export { FileService } from './file.service.js';
export type { SaveFileInput } from './file.service.js';
export type { FileModuleAsyncOptions, FileModuleOptions } from './options.js';
export { LocalStorageDriver } from './storage/local-storage.driver.js';
export type { LocalStorageDriverConfig } from './storage/local-storage.driver.js';
export type { StorageDriver } from './storage/storage-driver.interface.js';

export const FILE_NEST_VERSION = '0.1.0';
```

> 注：单测中覆盖 repo 用 `import { getRepositoryToken } from '@nestjs/typeorm'` 再 `overrideProvider(getRepositoryToken(FileEntity)).useValue({...})`。此为 TypeORM 官方 DI token，比字符串 'FileEntityRepository' 可靠，测试以它为准。

- [ ] **步骤 4：运行验证通过 + 构建**

```bash
pnpm --filter @coool/file-nest test
pnpm --filter @coool/file-nest build
```

预期：测试全过，`dist/index.js` + `dist/index.cjs` + `d.ts` 生成。

- [ ] **步骤 5：Commit**

```bash
git add packages/file-nest/src
git commit -m "feat(file-nest): FileModule forRoot/forRootAsync + 公共导出"
```

---

## 任务 6：file-nest README + VitePress 文档

**文件：** 创建 `packages/file-nest/README.md`、`docs/index.md`、`docs/.vitepress/config.ts`、`docs/guide/*.md`

- [ ] **步骤 1：写 VitePress 配置**

`packages/file-nest/docs/.vitepress/config.ts`：

```ts
import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: '@coool/file-nest',
  description: 'NestJS 文件存储集成模块：存储驱动抽象、元数据、DI',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: '路线图', link: '/guide/roadmap' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '连接配置', link: '/guide/configuration' },
          { text: 'FileService', link: '/guide/file-service' },
          { text: '存储驱动', link: '/guide/storage-driver' },
        ],
      },
      {
        text: '项目',
        items: [{ text: '路线图', link: '/guide/roadmap' }],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Cooooooler/lucy' },
    ],
    footer: {
      message: 'MIT License',
      copyright: 'Copyright © 2026 Cooooooler',
    },
  },
});
```

- [ ] **步骤 2：写 `docs/index.md`**（首页）

`packages/file-nest/docs/index.md`：

```md
---
layout: home
hero:
  name: @coool/file-nest
  tagline: NestJS 文件存储集成模块
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 在 GitHub 查看
      link: https://github.com/Cooooooler/lucy
features:
  - title: 存储驱动抽象
    details: StorageDriver 接口 + 本地磁盘实现，可插拔换 S3
  - title: 统一元数据
    details: FileEntity 落库记录文件名/MIME/大小/哈希，便于溯源
  - title: NestJS DI
    details: forRoot/forRootAsync 注册全局，forFeature 供消费模块注入
---
```

- [ ] **步骤 3：写 guide 页**

`packages/file-nest/docs/guide/getting-started.md`：

````md
# 快速开始

## 安装

```bash
pnpm add @coool/file-nest
```
````

## 注册模块

```ts
import { FileModule } from '@coool/file-nest';

@Module({
  imports: [
    FileModule.forRoot({
      dir: 'uploads', // 本地存储根目录
      storage: 'local',
    }),
  ],
})
export class AppModule {}
```

也可用 `forRootAsync` 读取配置（如 docker 中 `ConfigService`）：

```ts
FileModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    dir: config.get('UPLOAD_DIR', 'uploads'),
    storage: config.get('FILE_STORAGE', 'local'),
  }),
});
```

## 注入使用

```ts
constructor(private readonly fileService: FileService) {}
```

````

`packages/file-nest/docs/guide/configuration.md`：
```md
# 连接配置

`FileModuleOptions`：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dir` | `string` | `process.env.UPLOAD_DIR ?? 'uploads'` | 本地存储根目录 |
| `storage` | `string` | `'local'` | 写入 `FileEntity.storage` 的标识 |
| `driver` | `StorageDriver` | `LocalStorageDriver` | 自定义存储驱动 |
````

`packages/file-nest/docs/guide/file-service.md`：

````md
# FileService

## save

```ts
const file = await fileService.save({
  ownerId: 'u1',
  originalName: 'a.pdf',
  ext: '.pdf',
  mime: 'application/pdf',
  size: 1024,
  buffer,
});
```
````

## findById / read / remove

```ts
const file = await fileService.findById('f1'); // FileEntity | null
const buffer = await fileService.read(file);
await fileService.remove(file);
```

````

`packages/file-nest/docs/guide/storage-driver.md`：
```md
# 存储驱动

实现 `StorageDriver` 接口即可替换存储后端：

```ts
export interface StorageDriver {
  write(key: string, data: Buffer): Promise<void> | void;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void> | void;
}
````

在 `forRoot({ driver: MyDriver })` 传入即可。

````

- [ ] **步骤 4：写 README.md**

`packages/file-nest/README.md`：简要说明包用途、安装、快速示例，并链接到 `docs/`（VitePress 站点）。复制 redis 包 README 的编排风格。

- [ ] **步骤 5：验证文档可构建**

```bash
pnpm --filter @coool/file-nest docs:build
````

预期：`docs/.vitepress/dist` 生成，无报错。

- [ ] **步骤 6：Commit**

```bash
git add packages/file-nest/README.md packages/file-nest/docs
git commit -m "docs(file-nest): README + VitePress 使用文档"
```

---

## 任务 7：shared 新增 KNOWLEDGE_* 错误码

**文件：** 修改 `packages/shared/src/index.ts`

- [ ] **步骤 1：在 `ErrorCode` 对象末尾追加**

`packages/shared/src/index.ts` 中，`AI_GENERATE_TIMEOUT: 50002,` 之后、`} as const;` 之前插入：

```ts
  // 知识库错误
  KNOWLEDGE_NOT_FOUND: 40410,
  KNOWLEDGE_FORBIDDEN: 40301,
  KNOWLEDGE_INVALID_FILE_TYPE: 41501,
  KNOWLEDGE_FILE_TOO_LARGE: 41301,
  KNOWLEDGE_FILE_PARSE_FAILED: 42201,
```

- [ ] **步骤 2：验证**

```bash
pnpm --filter @lucy/shared build
```

预期：成功。

- [ ] **步骤 3：Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): KNOWLEDGE_* 错误码"
```

---

## 任务 8：knowledge 实体

**文件：** 创建 `apps/backend/src/knowledge/entities/knowledge-base.entity.ts`、`apps/backend/src/knowledge/entities/knowledge-document.entity.ts`

- [ ] **步骤 1：实现两实体**

`apps/backend/src/knowledge/entities/knowledge-base.entity.ts`：

```ts
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity.js';
import { KnowledgeDocument } from './knowledge-document.entity.js';

export enum KnowledgeBaseVisibility {
  Private = 'private',
  Public = 'public',
}

@Entity('knowledge_bases')
@Index('IDX_knowledge_bases_owner_visibility', ['ownerId', 'visibility'])
export class KnowledgeBase {
  @ApiProperty({ description: '知识库 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '属主用户 ID' })
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @ApiProperty({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: KnowledgeBaseVisibility.Private,
  })
  @Column({
    type: 'varchar',
    length: 10,
    default: KnowledgeBaseVisibility.Private,
  })
  visibility: KnowledgeBaseVisibility;

  @ApiProperty({ description: '名称' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ description: '描述', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ApiProperty({ description: '文档列表', type: () => [KnowledgeDocument] })
  @OneToMany(() => KnowledgeDocument, (d) => d.knowledgeBase)
  documents: KnowledgeDocument[];

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

`apps/backend/src/knowledge/entities/knowledge-document.entity.ts`：

```ts
import { FileEntity } from '@coool/file-nest';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeBase } from './knowledge-base.entity.js';

@Entity('knowledge_documents')
@Index('IDX_knowledge_documents_kb_created', ['knowledgeBaseId', 'createdAt'])
export class KnowledgeDocument {
  @ApiProperty({ description: '文档 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '所属知识库 ID' })
  @Index()
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId: string;

  @ApiProperty({ description: '源文件 ID' })
  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  @ApiHideProperty()
  @ManyToOne(() => KnowledgeBase, (kb) => kb.documents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledgeBase?: KnowledgeBase;

  @ApiHideProperty()
  @ManyToOne(() => FileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file?: FileEntity;

  @ApiProperty({ description: '标题' })
  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ApiProperty({ description: '解析出的纯文本', nullable: true })
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **步骤 2：Commit**

```bash
git add apps/backend/src/knowledge/entities
git commit -m "feat(knowledge): KnowledgeBase/KnowledgeDocument 实体"
```

---

## 任务 9：knowledge DTO

**文件：** 创建 `apps/backend/src/knowledge/dto/*.dto.ts`

- [ ] **步骤 1：实现四个 DTO**

`create-knowledge-base.dto.ts`：

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: '名称', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ description: '描述', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    description: '可见性',
    enum: KnowledgeBaseVisibility,
    default: 'private',
  })
  @IsOptional()
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;
}
```

`update-knowledge-base.dto.ts`：

```ts
import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto.js';

export class UpdateKnowledgeBaseDto extends PartialType(
  CreateKnowledgeBaseDto,
) {}
```

`knowledge-list-query.dto.ts`：

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { KnowledgeBaseVisibility } from '../entities/knowledge-base.entity.js';

export class KnowledgeListQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    description: '按可见性过滤',
    enum: KnowledgeBaseVisibility,
  })
  @IsOptional()
  @IsEnum(KnowledgeBaseVisibility)
  visibility?: KnowledgeBaseVisibility;

  @ApiPropertyOptional({ description: '名称关键字' })
  @IsOptional()
  @IsString()
  name?: string;
}
```

`document-list-query.dto.ts`：

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class DocumentListQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ description: '匹配标题/内容的关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
```

- [ ] **步骤 2：Commit**

```bash
git add apps/backend/src/knowledge/dto
git commit -m "feat(knowledge): DTO"
```

> 注：DTO 测试（`.dto.spec.ts`）可选——仓库现有 ai 的 DTO 有 spec。为控制篇幅，此处 DTO 不做独立 spec（由 service/controller spec 覆盖校验路径），需要时可补。

---

## 任务 10：magic-bytes + content-extractor

**文件：** 创建 `apps/backend/src/knowledge/magic-bytes.ts`、`content-extractor.ts`、`magic-bytes.spec.ts`、`content-extractor.spec.ts`

- [ ] **步骤 1：实现两工具**

`magic-bytes.ts`：

```ts
import { fileTypeFromBuffer } from 'file-type';

/** 用魔数嗅探真实文件类型（防伪装扩展名）；纯文本类（txt/md）file-type 无法识别，返回 null */
export async function detectFileType(
  buffer: Buffer,
): Promise<{ ext: string; mime: string } | null> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected ? { ext: detected.ext, mime: detected.mime } : null;
}
```

`content-extractor.ts`：

```ts
import mammoth from 'mammoth';
import PdfParse from 'pdf-parse';

/** 支持的文档扩展名白名单（含点） */
export const SUPPORTED_DOCUMENT_EXTS = ['.txt', '.md', '.pdf', '.docx'];

/** 按扩展名提取纯文本：txt/md 直接读 utf8，pdf/docx 走解析库 */
export async function extractContent(
  buffer: Buffer,
  ext: string,
): Promise<string> {
  switch (ext) {
    case '.pdf': {
      const { text } = await PdfParse(buffer);
      return text ?? '';
    }
    case '.docx': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value ?? '';
    }
    default:
      return buffer.toString('utf8');
  }
}
```

- [ ] **步骤 2：写测试**

`magic-bytes.spec.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { detectFileType } from './magic-bytes.js';

describe('detectFileType', () => {
  it('识别 PDF 魔数', async () => {
    const r = await detectFileType(Buffer.from('%PDF-1.4\n...'));
    expect(r).toEqual({ ext: 'pdf', mime: 'application/pdf' });
  });

  it('纯文本返回 null（无魔数）', async () => {
    expect(await detectFileType(Buffer.from('just plain text'))).toBeNull();
  });
});
```

`content-extractor.spec.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: 'pdf text', numpages: 1 })),
}));
vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn(async () => ({ value: 'docx text' })) },
}));

import mammoth from 'mammoth';
import PdfParse from 'pdf-parse';
import { extractContent } from './content-extractor.js';

describe('extractContent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('txt 直接读 utf8', async () => {
    expect(await extractContent(Buffer.from('你好'), '.txt')).toBe('你好');
  });

  it('md 直接读 utf8', async () => {
    expect(await extractContent(Buffer.from('# hi'), '.md')).toBe('# hi');
  });

  it('pdf 走 pdf-parse', async () => {
    expect(await extractContent(Buffer.from('%PDF'), '.pdf')).toBe('pdf text');
    expect(PdfParse).toHaveBeenCalled();
  });

  it('docx 走 mammoth', async () => {
    expect(await extractContent(Buffer.from('PK'), '.docx')).toBe('docx text');
    expect(mammoth.extractRawText).toHaveBeenCalled();
  });
});
```

- [ ] **步骤 3：运行测试**

```bash
pnpm --filter @lucy/backend test src/knowledge/magic-bytes.spec.ts src/knowledge/content-extractor.spec.ts
```

预期：全过。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/src/knowledge/magic-bytes.ts apps/backend/src/knowledge/content-extractor.ts apps/backend/src/knowledge/*.spec.ts
git commit -m "feat(knowledge): 魔数嗅探 + 内容解析器"
```

---

## 任务 11：KnowledgeService

**文件：** 创建 `apps/backend/src/knowledge/knowledge.service.ts`、`apps/backend/src/knowledge/knowledge.service.spec.ts`

- [ ] **步骤 1：写失败的测试**

`apps/backend/src/knowledge/knowledge.service.spec.ts`：

```ts
import { ErrorCode } from '@lucy/shared';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeService } from './knowledge.service.js';

describe('KnowledgeService', () => {
  const kbRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const docRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const fileService = {
    save: vi.fn(),
    findById: vi.fn(),
    remove: vi.fn(),
  };
  const config = new ConfigService({ FILE_MAX_SIZE: 1024 });

  let service: KnowledgeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KnowledgeService(
      kbRepo as never,
      docRepo as never,
      fileService as never,
      config,
    );
  });

  const kb = (over = {}) =>
    Object.assign(new KnowledgeBase(), {
      id: 'kb1',
      ownerId: 'u1',
      visibility: KnowledgeBaseVisibility.Private,
      name: '产品文档',
      description: null,
      ...over,
    });
  const doc = (over = {}) =>
    Object.assign(new KnowledgeDocument(), {
      id: 'd1',
      knowledgeBaseId: 'kb1',
      fileId: 'f1',
      title: 'a',
      content: null,
      ...over,
    });

  it('create 保存知识库（默认 private）', async () => {
    kbRepo.save.mockResolvedValue(kb());
    await expect(service.create('u1', { name: 'x' })).resolves.toBeInstanceOf(
      KnowledgeBase,
    );
    expect(kbRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        name: 'x',
        visibility: 'private',
      }),
    );
  });

  it('get 属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.get('u1', 'kb1')).resolves.toEqual(
      expect.any(KnowledgeBase),
    );
  });

  it('get 公开库非属主可读', async () => {
    kbRepo.findOne.mockResolvedValue(
      kb({ visibility: KnowledgeBaseVisibility.Public }),
    );
    await expect(service.get('u2', 'kb1')).resolves.toEqual(
      expect.any(KnowledgeBase),
    );
  });

  it('get 私有库非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.get('u2', 'kb1')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
    });
  });

  it('update 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.update('u2', 'kb1', { name: 'y' }),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
    });
  });

  it('remove 非属主抛 FORBIDDEN', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(service.remove('u2', 'kb1')).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FORBIDDEN },
    });
  });

  it('addDocument 校验非法扩展名', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('x'),
        originalname: 'a.exe',
        size: 1,
      } as never),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE },
    });
  });

  it('addDocument 超出大小限制', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const big = Buffer.alloc(2048);
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: big,
        originalname: 'a.txt',
        size: big.length,
      } as never),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FILE_TOO_LARGE },
    });
    expect(fileService.save).not.toHaveBeenCalled();
  });

  it('addDocument pdf 魔数不匹配拒收', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const { detectFileType } = await import('./magic-bytes.js');
    const spy = vi.spyOn(await import('./magic-bytes.js'), 'detectFileType');
    spy.mockResolvedValue({ ext: 'png', mime: 'image/png' });
    fileService.save.mockResolvedValue(
      Object.assign(new (await import('@coool/file-nest')).FileEntity(), {
        id: 'f1',
      }),
    );
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('notpdf'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE },
    });
    spy.mockRestore();
  });

  it('addDocument 解析失败回滚删除文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    fileService.save.mockResolvedValue({
      id: 'f1',
      key: 'f1.pdf',
      storage: 'local',
    });
    const extract = vi.spyOn(
      await import('./content-extractor.js'),
      'extractContent',
    );
    extract.mockRejectedValue(new Error('parse fail'));
    await expect(
      service.addDocument('u1', 'kb1', {
        buffer: Buffer.from('%PDF'),
        originalname: 'a.pdf',
        size: 4,
      } as never),
    ).rejects.toMatchObject({
      response: { code: ErrorCode.KNOWLEDGE_FILE_PARSE_FAILED },
    });
    expect(fileService.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
    );
    extract.mockRestore();
  });

  it('addDocument 正常上传并入库', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    const detect = vi.spyOn(await import('./magic-bytes.js'), 'detectFileType');
    detect.mockResolvedValue({ ext: 'pdf', mime: 'application/pdf' });
    const extract = vi.spyOn(
      await import('./content-extractor.js'),
      'extractContent',
    );
    extract.mockResolvedValue('正文');
    fileService.save.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.save.mockResolvedValue(doc({ content: '正文' }));
    await service.addDocument('u1', 'kb1', {
      buffer: Buffer.from('%PDF'),
      originalname: 'a.pdf',
      size: 4,
    } as never);
    expect(fileService.save).toHaveBeenCalled();
    expect(docRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'a', content: '正文' }),
    );
    detect.mockRestore();
    extract.mockRestore();
  });

  it('removeDocument 删文档并清文件', async () => {
    kbRepo.findOne.mockResolvedValue(kb());
    docRepo.findOne.mockResolvedValue(doc());
    fileService.findById.mockResolvedValue({ id: 'f1', key: 'f1.pdf' });
    docRepo.delete.mockResolvedValue({ affected: 1 });
    await service.removeDocument('u1', 'kb1', 'd1');
    expect(docRepo.delete).toHaveBeenCalledWith({
      id: 'd1',
      knowledgeBaseId: 'kb1',
    });
    expect(fileService.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' }),
    );
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/knowledge/knowledge.service.spec.ts
```

- [ ] **步骤 3：实现 KnowledgeService**

`apps/backend/src/knowledge/knowledge.service.ts`：

```ts
import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { extname, basename } from 'node:path';
import { Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception.js';
import {
  extractContent,
  SUPPORTED_DOCUMENT_EXTS,
} from './content-extractor.js';
import { detectFileType } from './magic-bytes.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import {
  KnowledgeBase,
  KnowledgeBaseVisibility,
} from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import type { FileService } from '@coool/file-nest';

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(KnowledgeDocument)
    private readonly docRepo: Repository<KnowledgeDocument>,
    private readonly fileService: FileService,
    private readonly config: ConfigService,
  ) {}

  create(userId: string, dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return this.kbRepo.save({
      ownerId: userId,
      name: dto.name,
      description: dto.description ?? null,
      visibility: dto.visibility ?? KnowledgeBaseVisibility.Private,
    });
  }

  async list(
    userId: string,
    query: KnowledgeListQueryDto,
  ): Promise<{
    list: KnowledgeBase[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.kbRepo
      .createQueryBuilder('kb')
      .orderBy('kb.updatedAt', 'DESC');
    if (query.visibility) {
      if (query.visibility === KnowledgeBaseVisibility.Private) {
        qb.where('kb.ownerId = :uid', { uid: userId }).andWhere(
          'kb.visibility = :v',
          {
            v: KnowledgeBaseVisibility.Private,
          },
        );
      } else {
        qb.where('kb.visibility = :v', { v: KnowledgeBaseVisibility.Public });
      }
    } else {
      qb.where('kb.ownerId = :uid', { uid: userId }).orWhere(
        'kb.visibility = :pub',
        {
          pub: KnowledgeBaseVisibility.Public,
        },
      );
    }
    if (query.name) {
      qb.andWhere('kb.name ILIKE :name', { name: `%${query.name}%` });
    }
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async get(userId: string, id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    return kb;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    if (dto.name !== undefined) kb.name = dto.name;
    if (dto.description !== undefined) kb.description = dto.description;
    if (dto.visibility !== undefined) kb.visibility = dto.visibility;
    return this.kbRepo.save(kb);
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    // 清理该库下所有文档的底层文件，避免孤儿
    const docs = await this.docRepo.find({ where: { knowledgeBaseId: id } });
    for (const d of docs) {
      const file = await this.fileService.findById(d.fileId);
      if (file) await this.fileService.remove(file);
    }
    await this.kbRepo.delete({ id });
    return { success: true };
  }

  async addDocument(
    userId: string,
    kbId: string,
    file: Express.Multer.File,
  ): Promise<KnowledgeDocument> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);

    const origExt = extname(file.originalname).toLowerCase();
    if (!SUPPORTED_DOCUMENT_EXTS.includes(origExt)) {
      throw new BusinessException(
        ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE,
        '不支持的文档类型，仅支持 txt/md/pdf/docx',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const maxSize = Number(this.config.get<number>('FILE_MAX_SIZE', 10485760));
    if (file.size > maxSize) {
      throw new BusinessException(
        ErrorCode.KNOWLEDGE_FILE_TOO_LARGE,
        '文件超过大小上限',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    // pdf 用魔数防伪装（docx 是 zip 容器魔数不可靠，靠 mammoth 解析兜底）
    if (origExt === '.pdf') {
      const detected = await detectFileType(file.buffer);
      if (!detected || detected.ext !== 'pdf') {
        throw new BusinessException(
          ErrorCode.KNOWLEDGE_INVALID_FILE_TYPE,
          'PDF 文件内容与扩展名不符',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
    }

    const fileEntity = await this.fileService.save({
      ownerId: userId,
      originalName: file.originalname,
      ext: origExt,
      mime: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });

    let content: string;
    try {
      content = await extractContent(file.buffer, origExt);
    } catch {
      await this.fileService.remove(fileEntity);
      throw new BusinessException(
        ErrorCode.KNOWLEDGE_FILE_PARSE_FAILED,
        '文档解析失败',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const title = basename(file.originalname, extname(file.originalname));
    return this.docRepo.save({
      knowledgeBaseId: kbId,
      fileId: fileEntity.id,
      title,
      content,
    });
  }

  async listDocuments(
    userId: string,
    kbId: string,
    query: DocumentListQueryDto,
  ): Promise<{
    list: KnowledgeDocument[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.docRepo
      .createQueryBuilder('d')
      .where('d.knowledgeBaseId = :kbId', { kbId })
      .orderBy('d.createdAt', 'DESC');
    if (query.keyword) {
      qb.andWhere('(d.title ILIKE :kw OR d.content ILIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async getDocument(
    userId: string,
    kbId: string,
    id: string,
  ): Promise<KnowledgeDocument> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertReadable(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    return doc;
  }

  async removeDocument(
    userId: string,
    kbId: string,
    id: string,
  ): Promise<{ success: true }> {
    const kb = await this.kbRepo.findOne({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    this.assertOwner(kb, userId);
    const doc = await this.docRepo.findOne({
      where: { id, knowledgeBaseId: kbId },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    await this.docRepo.delete({ id, knowledgeBaseId: kbId });
    const file = await this.fileService.findById(doc.fileId);
    if (file) await this.fileService.remove(file);
    return { success: true };
  }

  private assertOwner(kb: KnowledgeBase, userId: string): void {
    if (kb.ownerId !== userId) {
      throw new BusinessException(
        ErrorCode.KNOWLEDGE_FORBIDDEN,
        '仅知识库属主可操作',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertReadable(kb: KnowledgeBase, userId: string): void {
    if (kb.ownerId === userId) return;
    if (kb.visibility === KnowledgeBaseVisibility.Public) return;
    throw new BusinessException(
      ErrorCode.KNOWLEDGE_FORBIDDEN,
      '无权访问该知识库',
      HttpStatus.FORBIDDEN,
    );
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/knowledge/knowledge.service.spec.ts
```

预期：所有 it 通过（含 `list` 未显式测，若报 noUnusedLocals 请补一个 list 的 QueryBuilder mock）。`addDocument` 需要 mock `getManyAndCount` 等——若 `list`/`listDocuments` 未覆盖到，给 `kbRepo.createQueryBuilder`/`docRepo.createQueryBuilder` 返回带 `getManyAndCount` 的 mock。

> 补充：service.spec 中未直接用到的 `list`/`listDocuments` 会触发 `createQueryBuilder`，但只在该方法被调用时才访问。上面 it 未调用它们，故不需 mock builder。若 TS 报 unused，可忽略或补一个 list 用例。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/knowledge/knowledge.service.ts apps/backend/src/knowledge/knowledge.service.spec.ts
git commit -m "feat(knowledge): KnowledgeService 权限/上传/CRUD"
```

---

## 任务 12：KnowledgeController + KnowledgeModule

**文件：** 创建 `apps/backend/src/knowledge/knowledge.controller.ts`、`knowledge.module.ts`、`knowledge.controller.spec.ts`

- [ ] **步骤 1：实现 Controller**

`apps/backend/src/knowledge/knowledge.controller.ts`：

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeService } from './knowledge.service.js';

@ApiTags('knowledge')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  @ApiOperation({ summary: '创建知识库' })
  @ApiResponse({ status: 201, type: KnowledgeBase })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    return this.knowledgeService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '知识库列表', description: '返回自己的 + 公开的' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: KnowledgeListQueryDto,
  ) {
    return this.knowledgeService.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '知识库详情' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.get(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新知识库' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除知识库（级联清文档与文件）' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.remove(user.userId, id);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '上传文档',
    description: 'multipart/form-data，字段名 file',
  })
  addDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KnowledgeDocument> {
    if (!file) throw new BadRequestException('缺少文件字段 file');
    return this.knowledgeService.addDocument(user.userId, kbId, file);
  }

  @Get(':kbId/documents')
  @ApiOperation({ summary: '某知识库文档列表' })
  listDocuments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: DocumentListQueryDto,
  ) {
    return this.knowledgeService.listDocuments(user.userId, kbId, query);
  }

  @Get(':kbId/documents/:id')
  @ApiOperation({ summary: '文档详情（含解析文本）' })
  getDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.getDocument(user.userId, kbId, id);
  }

  @Delete(':kbId/documents/:id')
  @ApiOperation({ summary: '删除文档（连带清理文件）' })
  removeDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.removeDocument(user.userId, kbId, id);
  }
}
```

- [ ] **步骤 2：实现 Module + 接入 AppModule**

`apps/backend/src/knowledge/knowledge.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, KnowledgeDocument])],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
```

`apps/backend/src/app.module.ts`：在 `import` 区加：

```ts
import { FileModule } from '@coool/file-nest';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
```

在 `@Module` imports 的 `AiModule` 附近加（并在根导出加 `fileModuleOptions` 便于测试）：

```ts
FileModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    dir: config.get<string>('UPLOAD_DIR', 'uploads'),
    storage: config.get<string>('FILE_STORAGE', 'local'),
  }),
}),
KnowledgeModule,
```

- [ ] **步骤 3：controller spec（冒烟）**

`apps/backend/src/knowledge/knowledge.controller.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  const service = { create: vi.fn().mockResolvedValue({} as never) };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: service }],
    }).compile();
    controller = moduleRef.get(KnowledgeController);
  });

  it('create 转发到 service', async () => {
    await controller.create(
      { userId: 'u1', jti: 'j' } as never,
      { name: 'x' } as never,
    );
    expect(service.create).toHaveBeenCalledWith('u1', { name: 'x' });
  });
});
```

- [ ] **步骤 4：运行测试**

```bash
pnpm --filter @lucy/backend test src/knowledge
```

预期：全过。

- [ ] **步骤 5：Commit**

```bash
git add apps/backend/src/knowledge/knowledge.controller.ts apps/backend/src/knowledge/knowledge.module.ts apps/backend/src/knowledge/knowledge.controller.spec.ts apps/backend/src/app.module.ts
git commit -m "feat(knowledge): Controller + Module + 接入 AppModule"
```

---

## 任务 13：配置项（.env.example）

**文件：** 修改 `apps/backend/.env.example`

- [ ] **步骤 1：追加配置说明**

在 `.env.example` 的 AI 配置块之后追加：

```
# 知识库文件存储
FILE_STORAGE=local
# 文件大小上限（字节），默认 10485760（10MB）
FILE_MAX_SIZE=10485760
# 本地存储根目录，默认 uploads
UPLOAD_DIR=uploads
```

- [ ] **步骤 2：Commit**

```bash
git add apps/backend/.env.example
git commit -m "chore(backend): 知识库文件存储配置项"
```

---

## 任务 14：迁移 CreateKnowledgeTables

**文件：** 创建 `apps/backend/src/db/migrations/1787750000000-CreateKnowledgeTables.ts`

- [ ] **步骤 1：写迁移**

`apps/backend/src/db/migrations/1787750000000-CreateKnowledgeTables.ts`：

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKnowledgeTables1787750000000 implements MigrationInterface {
  name = 'CreateKnowledgeTables1787750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "original_name" character varying(255) NOT NULL, "ext" character varying(20) NOT NULL, "mime" character varying(100) NOT NULL, "size" integer NOT NULL, "key" character varying(255) NOT NULL, "hash" character(64) NOT NULL, "storage" character varying(20) NOT NULL DEFAULT 'local', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_files_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_files_owner" ON "files" ("owner_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_bases" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "visibility" character varying(10) NOT NULL DEFAULT 'private', "name" character varying(100) NOT NULL, "description" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_bases_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_bases_owner_visibility" ON "knowledge_bases" ("owner_id", "visibility") `,
    );
    await queryRunner.query(
      `CREATE TABLE "knowledge_documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "knowledge_base_id" uuid NOT NULL, "file_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "content" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_documents_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb" ON "knowledge_documents" ("knowledge_base_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_kb_created" ON "knowledge_documents" ("knowledge_base_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_knowledge_documents_file" ON "knowledge_documents" ("file_id") `,
    );
    // 外键
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_kb" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD CONSTRAINT "FK_knowledge_documents_file" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD CONSTRAINT "FK_knowledge_bases_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" DROP CONSTRAINT "FK_knowledge_bases_owner"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_file"`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" DROP CONSTRAINT "FK_knowledge_documents_kb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_file"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_documents_kb_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_knowledge_documents_kb"`);
    await queryRunner.query(`DROP TABLE "knowledge_documents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_knowledge_bases_owner_visibility"`,
    );
    await queryRunner.query(`DROP TABLE "knowledge_bases"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_files_owner"`);
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
```

- [ ] **步骤 2：执行迁移（需本地 DB + `docker compose up -d` 的 postgres）**

```bash
pnpm --filter @lucy/backend db:migrate
```

预期：迁移成功，三表 + 索引 + 外键创建完成。若迁移失败，检查 DB 连接与 `users.id` 是否为 uuid。

- [ ] **步骤 3：验证 schema**

```bash
pnpm --filter @lucy/backend db:show
```

预期：能看到 knowledge_bases / knowledge_documents / files 表。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/src/db/migrations/1787750000000-CreateKnowledgeTables.ts
git commit -m "feat(knowledge): CreateKnowledgeTables 迁移"
```

> **自检提醒**：`migration:run` 前务必人工审查 up/down 无遗留（如多余表/重复约束）。若 `db:show` 无此命令，可用 `migration:run` + psql `\dt` 查询核对三表。

---

## 任务 15：全量验证

**文件：** 无需改动，仅运行命令

- [ ] **步骤 1：file-nest 完整验证**

```bash
pnpm --filter @coool/file-nest build
pnpm --filter @coool/file-nest test
pnpm --filter @coool/file-nest typecheck
```

- [ ] **步骤 2：shared**

```bash
pnpm --filter @lucy/shared build
```

- [ ] **步骤 3：backend 完整验证（含 typegen 重新生成共享契约）**

```bash
pnpm typegen
pnpm --filter @lucy/backend build
pnpm --filter @lucy/backend test
pnpm --filter @lucy/backend typecheck
pnpm lint
```

- [ ] **步骤 4：全仓**

```bash
pnpm build
pnpm test
pnpm typecheck
```

- [ ] **步骤 5：Commit**（若 typegen/代码格式化产生变更）

```bash
git add -A
git commit -m "chore: 知识库全量回归通过"
```

> 若无变更则跳过。前端本次无改动（知识库前端后续单独做）。

---

## 自检记录（写完计划后核对）

- **规格覆盖度**：`file-nest` 包、`shared` 错误码、`knowledge` 双实体、上传解析、权限（写仅属主/公开可读）、迁移、.env、VitePress 文档，均有对应任务。✅
- **占位符扫描**：无 TODO/待定。迁移 SQL 已核对，仅 3 表 + 索引 + 外键，无多余对象。✅
- **类型一致性**：`FileService.save/read/remove/findById` 在任务 4 定义、任务 11 使用，签名一致；`SUPPORTED_DOCUMENT_EXTS`/`extractContent`/`detectFileType` 在任务 10 定义、任务 11 使用一致。✅

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-08-23-knowledge-base-backend.md`，两种执行方式：

1. **子代理驱动（推荐）** — 每个任务调度新子代理，任务间审查，快速迭代。要求 superpowers:subagent-driven-development。
2. **内联执行** — 当前会话用 executing-plans 逐任务执行，带检查点。

**选哪种方式？**
