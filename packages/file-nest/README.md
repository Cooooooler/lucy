# @coool/file-nest

NestJS 文件存储集成模块：**纯存储层 · 存储驱动抽象 · NestJS DI**。

本包只做一件事：把「文件字节」交给 `StorageDriver` 存储，并返回文件描述（`StoredFile`）。它是**纯存储层**——零 TypeORM、不管理任何数据库表；文件元数据（含属主、`owner_id→users` 外键等 schema）由**调用方**持久化与定义，`ownerId` 属主校验由调用方业务层承担。

> 完整文档见 [VitePress 文档站](docs/index.md)（本地预览：`pnpm docs:dev`）。

## 特性

- **存储驱动抽象**：`StorageDriver` 接口 + `LocalStorageDriver` 本地磁盘实现，可插拔换 S3。
- **纯存储层**：`save` 写入字节并返回 `StoredFile`（`key`/`ext`/`mime`/`size`/`hash`/`storage`），不落库任何元数据。
- **NestJS DI**：`forRoot` / `forRootAsync` 注册全局（`global: true`），`FileService` 注入即用。

## 安装

```bash
pnpm add @coool/file-nest
```

`@nestjs/common`、`@nestjs/core` 为 peerDependencies。

## 快速开始

```ts
import { Injectable, Module } from '@nestjs/common';
import { FileModule, FileService } from '@coool/file-nest';

@Module({
  imports: [FileModule.forRoot({ dir: 'uploads', storage: 'local' })],
})
export class AppModule {}

@Injectable()
export class SomeService {
  constructor(private readonly fileService: FileService) {}

  async save(buffer: Buffer): Promise<void> {
    const file = await this.fileService.save({
      buffer,
      ext: '.pdf',
      mime: 'application/pdf',
    });
    // file: StoredFile = { key, ext, mime, size, hash, storage }
    // 持久化 StoredFile（含属主等业务元数据）由调用方负责
  }
}
```

> 元数据（属主、关联业务实体等）不入本包；如需落库，由调用方自行定义表结构并持久化 `StoredFile`。

## 本地文档预览

```bash
pnpm --filter @coool/file-nest docs:dev   # http://localhost:5173
```

## License

MIT
