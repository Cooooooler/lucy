# 连接配置

`forRoot` / `forRootAsync` 均接收 `FileModuleOptions`：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dir` | `string` | `process.env.UPLOAD_DIR ?? 'uploads'` | 本地存储根目录（`LocalStorageDriver` 使用） |
| `storage` | `string` | `'local'` | 存储驱动标识（写回 `StoredFile.storage`） |
| `driver` | `StorageDriver` | `LocalStorageDriver({ dir })` | 自定义存储驱动，缺省用本地磁盘实现 |

## forRoot

```ts
FileModule.forRoot({
  dir: 'uploads',
  storage: 'local',
});
```

## forRootAsync

`forRootAsync` 接收 `FileModuleAsyncOptions`，`useFactory` 返回 `FileModuleOptions` 对象：

```ts
FileModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    dir: config.get('UPLOAD_DIR', 'uploads'),
    storage: config.get('FILE_STORAGE', 'local'),
  }),
});
```

> `dir` 只影响本地磁盘驱动；换用 S3 等远端驱动时可通过 `driver` 注入，`dir` 可忽略。
