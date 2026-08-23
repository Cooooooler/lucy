# 路线图

`@coool/file-nest` 已提供文件存储集成的核心能力，后续围绕「可插拔远端驱动 + 后端接入」继续演进。

## 当前可用

- `FileModule.forRoot` / `forRootAsync`（全局注册，导出 `FileService`）
- `FileService`：`save`（返回 `StoredFile`）/ `read` / `remove`（按 `key`）
- `StorageDriver` 接口 + `LocalStorageDriver`（含路径穿越拦截）
- `StoredFile`：字节存储后的文件描述（`key` / `ext` / `mime` / `size` / `hash` / `storage`）；纯存储层，元数据不落库、由调用方持久化

## 后续规划

| 事项                              | 状态            |
| --------------------------------- | --------------- |
| S3 / OSS 等远端存储驱动           | ⏳ 规划中       |
| 文件分片 / 大文件上传             | ⏳ 规划中       |
| 内容类型嗅探（magic-bytes）与提取 | ⏳ 依赖后续任务 |
| 后端知识库模块狗食化接入          | ⏳ 规划中       |

## 明确不做

分布式文件系统、CDN 分发、文件在线预览不在当前档位范围内。
