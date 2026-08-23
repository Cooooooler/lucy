# @coool/file-nest

NestJS 文件存储集成模块：**存储驱动抽象 · 元数据落库 · DI**。

把「文件字节怎么存」与「文件描述信息怎么记」解耦：字节交给 `StorageDriver`，描述信息（原文件名 / MIME / 大小 / SHA-256 哈希）落库到 `FileEntity`，业务侧不经底层存储即可读写删文件。

> 完整文档见 [VitePress 文档站](docs/index.md)（本地预览：`pnpm docs:dev`）。

## 特性

- **存储驱动抽象**：`StorageDriver` 接口 + `LocalStorageDriver` 本地磁盘实现，可插拔换 S3。
- **统一元数据**：`FileEntity` 落库记录文件名 / MIME / 大小 / 扩展名 / `key` / 哈希，便于溯源。
- **NestJS DI**：`forRoot` / `forRootAsync` 注册全局（`global: true`），`FileService` 注入即用。

## 安装

```bash
pnpm add @coool/file-nest
```

`@nestjs/common`、`@nestjs/core`、`@nestjs/swagger`、`@nestjs/typeorm`、`typeorm` 为 peerDependencies。

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
      ownerId: 'u1',
      originalName: 'a.pdf',
      ext: '.pdf',
      mime: 'application/pdf',
      size: buffer.length,
      buffer,
    });
  }
}
```

## 本地文档预览

```bash
pnpm --filter @coool/file-nest docs:dev   # http://localhost:5173
```

## License

MIT
