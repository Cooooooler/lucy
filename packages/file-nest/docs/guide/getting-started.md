# 快速开始

## 安装

`@coool/file-nest` 的 peerDependencies 为 `@nestjs/common` 与 `@nestjs/core`，安装本包即可（NestJS 应用中通常已存在）：

```bash
pnpm add @coool/file-nest
```

本包为**纯存储层**：零 TypeORM、不管理任何数据库表。文件元数据（含属主、`owner_id→users` 外键等 schema）由**调用方**持久化与定义，`ownerId` 属主校验由调用方业务层承担。

## 注册模块

在根模块用 `forRoot` 注册一次。模块为全局（`global: true`），应用内任何地方都可注入 `FileService`：

```ts
// app.module.ts
import { Module } from '@nestjs/common';
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

若配置来自环境变量/配置中心，用 `forRootAsync`：

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileModule } from '@coool/file-nest';

@Module({
  imports: [
    FileModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dir: config.get('UPLOAD_DIR', 'uploads'),
        storage: config.get('FILE_STORAGE', 'local'),
      }),
    }),
  ],
})
export class AppModule {}
```

## 注入使用

`FileModule` 是全局模块，任何 service 都可直接注入 `FileService`：

```ts
import { Injectable } from '@nestjs/common';
import { FileService } from '@coool/file-nest';

@Injectable()
export class SomeService {
  constructor(private readonly fileService: FileService) {}
}
```

> 本包不落库：`save` 返回 `StoredFile` 后，由调用方决定是否/如何持久化其元数据（含属主关系）。
