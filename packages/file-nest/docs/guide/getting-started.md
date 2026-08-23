# 快速开始

## 安装

`@coool/file-nest` 的 peerDependencies 为 `@nestjs/common`、`@nestjs/core`、`@nestjs/swagger`、`@nestjs/typeorm` 与 `typeorm`，安装本包即可（NestJS 应用中通常已存在）：

```bash
pnpm add @coool/file-nest
```

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

> 使用 `FileService.save` 前需确保 `FileEntity` 对应的表已迁移（`FileModule` 内通过 `TypeOrmModule.forFeature([FileEntity])` 接入仓库）。
