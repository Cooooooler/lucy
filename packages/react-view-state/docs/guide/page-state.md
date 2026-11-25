# 页面状态缓存

把「再次进入路由时需要恢复」的 UI 状态托管到模块级 store：页面卸载后 store 仍存活，重新挂载时**第一次渲染**就读到上次的值——不需要 effect，也不会闪一帧初始值。

## 基本用法

```tsx
import { PageStateCache, usePageState } from '@coool/react-view-state';

const Page = () => {
  // 签名与 useState 完全一致
  const [keyword, setKeyword] = usePageState('keyword', '');
  const [visibility, setVisibility] = usePageState<'all' | 'public'>(
    'visibility',
    'all',
  );

  return <Toolbar keyword={keyword} onKeywordChange={setKeyword} />;
};

export const Route = createFileRoute('/knowledge/')({
  component: () => (
    <PageStateCache cacheKey="knowledge-list">
      <Page />
    </PageStateCache>
  ),
});
```

## API

### `<PageStateCache cacheKey children />`

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `cacheKey` | `string` | 页面标识；页面内所有 `usePageState` 字段都挂在这份 store 下 |
| `children` | `ReactNode` | 页面内容 |

`cacheKey` 建议用固定字符串（如 `'knowledge-list'`），不要拼路由参数——否则注册表会随参数无界增长。

### `usePageState(field, initial)`

返回 `[value, setValue]`，`setValue` 与 `useState` 的 setter 相同（支持函数式更新）。

- `field` 在同一 `cacheKey` 内应唯一。
- `initial` 只在缓存里还没有该字段时生效，挂载后冻结，不会被后续渲染的初始值覆盖。
- 同一 `cacheKey` 下的多个组件读写同一字段时共享同一份值。
- 写入与旧值 `Object.is` 相等时不换对象，避免无谓的订阅者重渲染。

在 `<PageStateCache>` 之外调用会抛出 `usePageState 必须放在 <PageStateCache> 内使用`。

### 清理

```ts
import {
  clearPageStateCaches,
  resetPageStateCache,
} from '@coool/react-view-state';

clearPageStateCaches(); // 清空全部页面（登出 / 会话过期）
resetPageStateCache('knowledge-list'); // 只清某一个页面
```

登出场景通常直接用 `clearViewCaches()`（同时清滚动位置）。

## 边界

- **只缓存 UI 状态**：筛选条件、展开项、分页等。服务端数据交给 TanStack Query 等数据层，两套缓存并存会互相打架。
- **只放可序列化的值**：不要放 DOM 节点、Form 实例；保留后续接入 `sessionStorage` 的可能。
- **不是所有 state 都该缓存**：抽屉开关、表单临时值通常属于「离开即丢弃」，继续用 `useState`。
- **内存态**：F5 即清空；需要跨刷新恢复要另加持久化。
- **作用域是外壳**：只有经过 `usePageState` 的字段会被缓存，普通 `useState` 不受影响。
