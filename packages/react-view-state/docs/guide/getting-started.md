# 快速开始

## 安装

peerDependency 为 `react ^19`，安装本包即可（React 应用里通常已存在）：

```bash
pnpm add @coool/react-view-state
```

包提供 ESM + CJS 双格式，类型从 `src` 导出；无任何持久化依赖，两套缓存都是**内存态**（F5 即清空）。

## 两个能力，一个 key

| 能力 | 入口 | 解决的问题 |
| --- | --- | --- |
| 页面状态缓存 | `PageStateCache` + `usePageState` | 路由重新进入时恢复筛选条件、展开项等 UI 状态 |
| 滚动位置记忆 | `useScrollMemory` | 离开页面再回来时回到原滚动位置 |

两者都以字符串 `cacheKey` 为作用域，约定**同一个页面用同一个 key**，例如知识库列表页都用 `'knowledge-list'`。

## 最小示例

```tsx
import {
  PageStateCache,
  usePageState,
  useScrollMemory,
} from '@coool/react-view-state';

const ListPage = () => {
  // 1) 页面状态：用法与 useState 一致，页面卸载后值仍保留
  const [keyword, setKeyword] = usePageState('keyword', '');
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  // 2) 滚动位置：普通容器由 hook 自己恢复
  const { resetToTop } = useScrollMemory({
    cacheKey: 'knowledge-list',
    scrollElement,
  });

  const handleSearch = (value: string) => {
    setKeyword(value);
    resetToTop(); // 筛选变化：清掉记忆并回到顶部
  };

  return (
    <div ref={setScrollElement} className="h-full overflow-y-auto">
      {/* ... */}
    </div>
  );
};

// 3) 用 PageStateCache 绑定页面的缓存作用域
export const Route = createFileRoute('/knowledge/')({
  component: () => (
    <PageStateCache cacheKey="knowledge-list">
      <ListPage />
    </PageStateCache>
  ),
});
```

## 登出清理

```ts
import { clearViewCaches } from '@coool/react-view-state';

clearViewCaches(); // 页面状态 + 滚动位置一起清空
```

在登出 / 会话过期时调用，避免下一个账号读到上一个账号的页面状态与滚动位置。

## 下一步

- [页面状态缓存](/guide/page-state)
- [滚动位置记忆](/guide/scroll-memory)
