# 工具（规划中）

::: warning 尚未实现本功能属于实现计划的**第 5 步**，当前未发布。以下为规划方向，API 可能调整。:::

规划能力：

- `hashTag(key)`：生成 `{key}` 散列槽标签。
- `RedisService.pipeline(...)`：ioredis pipeline 封装。

```ts
// 规划中的用法示意
import { hashTag } from '@coool/redis-nest';

const key = hashTag('user:123'); // '{user:123}'
```

详见实现计划 `docs/superpowers/plans/` 中对应阶段。
