# 滚动位置记忆

`useScrollMemory` 在滚动过程中把容器的 `scrollTop` 写进模块级缓存（不触发渲染），离开页面后再次进入时恢复一次。支持两种恢复方式：

- `'dom'`（默认）：hook 自己写 `scrollTop`，适用于普通滚动容器；
- `'delegate'`：hook 只回传待恢复偏移，由虚拟化列表内部对齐（还要同步虚拟化器的内部 offset，只写 DOM 会先按旧位置挂一整窗卡片）。

## 基本用法（普通容器）

```tsx
import { useScrollMemory } from '@coool/react-view-state';

const Page = () => {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const { resetToTop } = useScrollMemory({
    cacheKey: 'docs', // 与 PageStateCache 的 cacheKey 同值即可
    scrollElement,
    ready: !isLoading, // 内容渲染完成后再恢复，避免按骨架高度截断
  });

  return (
    <div ref={setScrollElement} className="h-full overflow-y-auto">
      {content}
    </div>
  );
};
```

- 恢复在**布局阶段**完成（paint 前），不会闪。
- 恢复是一次性的：消费后本次挂载不再回放，否则 `resetToTop()` 的归零会被旧锚点覆盖。
- 筛选变化 / 手动刷新时调用 `resetToTop()`：清空该 key 的记忆并滚回顶部。

## 选项

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `cacheKey` | `string` | — | 记忆标识；同一 key 的滚动容器共享位置 |
| `scrollElement` | `HTMLElement \| null` | — | 滚动容器；变化时重新绑定监听 |
| `restoreMode` | `'dom' \| 'delegate'` | `'dom'` | 恢复方式，见下文 |
| `ready` | `boolean` | `true` | `'dom'` 模式下内容就绪后才恢复 |

## 返回值

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `restoreOffset` | `number \| null` | 本次挂载待恢复的偏移；`null` 表示无需恢复或已消费 |
| `consumeRestore` | `() => void` | `'delegate'` 模式：消费方对齐完成后调用 |
| `resetToTop` | `() => void` | 清空记忆并回到顶部 |

## 虚拟化列表（delegate 模式）

虚拟列表的可见窗口由虚拟化器按内部 offset 计算，只写 DOM 会造成「先白挂一窗卡片」。约定如下：

```tsx
const scrollMemory = useScrollMemory({
  cacheKey: 'knowledge-list',
  scrollElement,
  restoreMode: 'delegate',
});

<VirtualCardGrid scrollMemory={scrollMemory} />;
```

消费方（虚拟列表）需要：

1. 用 `restoreOffset` 作为虚拟化器的初始 offset（首帧窗口就按目标位置计算）；
2. 在布局阶段同时写 `scrollTop` 与虚拟化器内部 offset；
3. 内部 offset 使用**回读值**：内容比记忆位置短时（分页缓存过期、只加载了第一页）浏览器会把 `scrollTop` clamp 到可滚动最远处，照抄原始 offset 会让可视区间落在尚未加载的分页之外——整屏空白且触底加载也不会被触发；
4. 完成后调用 `consumeRestore()`，避免重挂时回放旧锚点。

`@lucy/frontend` 的 `useVirtualGrid` 已按此协议实现，可直接参考。

## 清理

```ts
import {
  clearAllScrollOffsets,
  clearScrollOffset,
} from '@coool/react-view-state';

clearScrollOffset('knowledge-list'); // 只清一个页面
clearAllScrollOffsets(); // 全部（登出场景用 clearViewCaches 即可）
```

## 注意事项

- **内存态**：F5 即清空，不跨刷新。
- **`cacheKey` 生命周期内保持稳定**：与 `useState` 首值同理，初值只读一次。
- **内容不足时按可滚动最远位置恢复**（浏览器 clamp），不会为了记忆位置去强行补内容。
- 恢复前处于加载骨架时，`'dom'` 模式应通过 `ready` 挡住，避免按骨架高度截断。
