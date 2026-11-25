# @coool/react-view-state

React 视图状态工具：**页面级状态缓存**与**滚动位置记忆**。两者都是模块级内存缓存，页面卸载后保留，登出时统一清空。

- React 19（peerDependency）
- ESM + CJS，类型直接从源码导出
- 无持久化：F5 即清空（需要跨刷新恢复时另行接入 sessionStorage）

## 文档

完整指南见 [`docs/`](./docs)（VitePress）：

```bash
pnpm --filter @coool/react-view-state docs:dev    # 本地预览
pnpm --filter @coool/react-view-state docs:build  # 构建静态站点
```

## 安装

```bash
pnpm add @coool/react-view-state
# peer: react
```

## 页面状态缓存

路由重新进入时恢复筛选条件等 UI 状态。用 `<PageStateCache cacheKey>` 包住页面，页面内用 `usePageState(field, initial)` 替代 `useState`：

```tsx
import { PageStateCache, usePageState } from '@coool/react-view-state';

const KnowledgePage = () => {
  const [keyword, setKeyword] = usePageState('keyword', '');
  // ...
  return <Toolbar value={keyword} onChange={setKeyword} />;
};

export const Route = createFileRoute('/knowledge/')({
  component: () => (
    <PageStateCache cacheKey="knowledge-list">
      <KnowledgePage />
    </PageStateCache>
  ),
});
```

- 首次渲染即读到缓存值，不会闪一帧初始值。
- `initial` 只在缓存里还没有该字段时生效。
- `field` 在同一 `cacheKey` 内唯一；`cacheKey` 用固定字符串，不要拼路由参数。
- 只缓存可序列化的 UI 状态（DOM 节点、Form 实例不要放进来）。

## 滚动位置记忆

```tsx
import { useScrollMemory } from '@coool/react-view-state';

// 1) 普通滚动容器：hook 自己恢复 scrollTop
const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
const { resetToTop } = useScrollMemory({
  cacheKey: 'docs', // 与 PageStateCache 的 cacheKey 同值即可
  scrollElement,
  ready: !isLoading, // 内容渲染完成后再恢复，避免按骨架高度截断
});

<div ref={setScrollElement} className="overflow-y-auto">
  {children}
</div>;
```

- 滚动中持续写回模块级 Map（不触发渲染），重新进入时一次性恢复并消费锚点。
- `resetToTop()` 清空记忆并回到顶部；筛选变化、手动刷新时调用。

### 虚拟化列表

虚拟列表还要同步虚拟化器的内部 offset，只写 DOM 会先按旧位置挂一整窗卡片。传 `restoreMode: 'delegate'`，把返回值交给列表自己对齐：

```tsx
const scrollMemory = useScrollMemory({
  cacheKey: 'knowledge-list',
  scrollElement,
  restoreMode: 'delegate',
});

<VirtualCardGrid scrollMemory={scrollMemory} />;
```

`delegate` 模式下 hook 不写 DOM，只回传 `restoreOffset`；消费方恢复完成后调用 `consumeRestore()`（`@lucy/frontend` 的 `useVirtualGrid` 已按此协议实现，并在对齐后回读 clamp 值，避免位置超界导致整屏空白）。

## 登出清理

```ts
import { clearViewCaches } from '@coool/react-view-state';

clearViewCaches(); // 页面状态 + 滚动位置一起清空
```

也可单独调用 `clearPageStateCaches()` / `resetPageStateCache(key)` / `clearScrollOffset(key)` / `clearAllScrollOffsets()`。
