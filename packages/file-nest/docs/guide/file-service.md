# FileService

`FileService` 是 `@coool/file-nest` 的核心门面：负责「写对象存储 + 落元数据」。它由 `FileModule` 全局导出，注入即用。

## save

写入对象存储，并把描述信息落库到 `FileEntity`。`key` 在内部生成（`<uuid><ext>`），`hash` 为内容 SHA-256 校验和：

```ts
const file = await fileService.save({
  ownerId: 'u1',
  originalName: 'a.pdf',
  ext: '.pdf',
  mime: 'application/pdf',
  size: 1024,
  buffer,
});
// FileEntity：含 id / key / hash / storage 等
```

`SaveFileInput`：

| 字段           | 类型     | 说明                      |
| -------------- | -------- | ------------------------- |
| `ownerId`      | `string` | 文件属主用户 ID           |
| `originalName` | `string` | 原始文件名                |
| `ext`          | `string` | 扩展名（含点，如 `.pdf`） |
| `mime`         | `string` | MIME 类型                 |
| `size`         | `number` | 文件大小（字节）          |
| `buffer`       | `Buffer` | 文件内容                  |

## findById / read / remove

```ts
const file = await fileService.findById('f1'); // FileEntity | null
const buffer = await fileService.read(file); // Buffer
await fileService.remove(file); // 删对象存储 + 删元数据
```

- `findById(id)`：按主键查元数据，不存在返回 `null`。
- `read(file)`：按 `file.key` 从存储驱动读回文件内容。
- `remove(file)`：先删存储对象，再删除元数据记录。
