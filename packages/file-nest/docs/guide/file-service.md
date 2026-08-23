# FileService

`FileService` 是 `@coool/file-nest` 的核心门面：负责「把文件字节写入存储驱动」。它由 `FileModule` 全局导出，注入即用。

> 本包为**纯存储层**：`FileService` 不落库、不管理任何数据库表。文件元数据（含属主、`owner_id→users` 外键等 schema）由**调用方**持久化与定义，`ownerId` 属主校验由调用方业务层承担。

## save

把文件字节写入存储驱动，并返回文件描述。`key` 在内部生成（`<uuid><ext>`），`hash` 为内容 SHA-256 校验和；元数据落库由消费方负责：

```ts
const file = await fileService.save({
  buffer,
  ext: '.pdf',
  mime: 'application/pdf',
});
// file: StoredFile = { key, ext, mime, size, hash, storage }
```

`save` 入参：

| 字段     | 类型     | 说明                      |
| -------- | -------- | ------------------------- |
| `buffer` | `Buffer` | 文件内容                  |
| `ext`    | `string` | 扩展名（含点，如 `.pdf`） |
| `mime`   | `string` | MIME 类型                 |

`StoredFile`（返回值）：

| 字段      | 类型     | 说明                          |
| --------- | -------- | ----------------------------- |
| `key`     | `string` | 存储相对路径（`<uuid><ext>`） |
| `ext`     | `string` | 扩展名（含点，如 `.pdf`）     |
| `mime`    | `string` | MIME 类型                     |
| `size`    | `number` | 文件大小（字节）              |
| `hash`    | `string` | 内容 SHA-256 校验和           |
| `storage` | `string` | 存储驱动标识，默认 `'local'`  |

## read / remove

按 `key` 读写删除文件字节（`key` 即 `save` 返回的 `StoredFile.key`）：

```ts
const buffer = await fileService.read(file.key); // Buffer
await fileService.remove(file.key); // 删存储对象
```

- `read(key)`：从存储驱动读回文件内容。
- `remove(key)`：从存储驱动删除存储对象。

> 本包不维护元数据，故无 `findById`。文件与其属主/业务实体的关联由调用方另行持久化。
