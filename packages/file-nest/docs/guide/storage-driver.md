# 存储驱动

本包为**纯存储层**，不落库任何元数据；文件对象与字节交给 `StorageDriver`。实现该接口即可替换存储后端（本地磁盘、S3、OSS……）。

## StorageDriver 接口

```ts
export interface StorageDriver {
  write(key: string, data: Buffer): Promise<void> | void;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void> | void;
}
```

- `key` 为相对路径，通常为单层文件名（`FileService` 约定），驱动不强制单层。
- `write` / `delete` 允许同步返回或返回 `Promise`。

## LocalStorageDriver

内置的本地磁盘实现：文件落在 `dir/<key>`，目录自动创建；`key` 会校验并拦截 `..`（路径穿越）与 `\`（Windows 分隔符）。

```ts
const driver = new LocalStorageDriver({ dir: 'uploads' });
```

## 自定义驱动

实现 `StorageDriver` 后，在 `forRoot({ driver })` 传入即可覆盖默认实现：

```ts
FileModule.forRoot({
  dir: 'uploads',
  driver: new MyS3Driver({ bucket: 'lucy' }),
});
```

或用 `forRootAsync` 的 `useFactory` 动态构造：

```ts
FileModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    driver: new MyS3Driver({ bucket: config.get('S3_BUCKET') }),
  }),
});
```

> 驱动标识通过 `FileModuleOptions.storage` 写入 `StoredFile.storage`，便于同一应用内多驱动混用（如 `local` / `s3`）。
