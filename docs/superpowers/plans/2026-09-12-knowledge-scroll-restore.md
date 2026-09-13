# 知识库列表「返回恢复」实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 SPA 返回知识库时恢复筛选条件、已加载分页与滚动位置，同时保证任何路径都不会重放/连续请求列表接口。

**架构：** 请求侧用 `refetchOnMount: false` + `refetchOnReconnect: false` 取代上一轮的 `gcTime: 0`（缓存保留默认 5 分钟，不再重挂载重放）；位置用虚拟化器上报的**首可见项索引**记在模块级会话 store 里，挂载时用 `scrollToIndex` 一次性恢复；筛选与位置同 store，F5 清空。

**技术栈：** React 19、TanStack Query v5（`useInfiniteQuery`）、`@tanstack/react-virtual` 3.x、TanStack Router、Vitest + Testing Library（jsdom）、Chrome MCP（实测）。

**依据规格：** `docs/superpowers/specs/2026-09-12-knowledge-scroll-restore-design.md`

> **提交说明（本轮约定）：** 当前工作区有大量在途改动（游标分页重构），`pre-commit` 会执行 `pnpm typegen` 并强制 `git add packages/shared/src/generated/openapi.ts`。因此**本轮不在每个任务后单独 commit**，所有改动在工作区累积，最后按任务 7 统一整理提交。任务末的勾选步骤不含 commit。

---

## 文件结构

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `apps/frontend/src/hooks/use-knowledge.ts` | 无限查询请求选项：缓存保留 + 不重放 | 修改 |
| `apps/frontend/src/hooks/use-virtual-grid.ts` | 虚拟化网格：新增首可见项上报与一次性恢复 | 修改 |
| `apps/frontend/src/hooks/use-knowledge-view-state.ts` | 会话内视图状态（筛选 + 首可见项索引）store 与 hook | 创建 |
| `apps/frontend/src/components/knowledge/KnowledgeGrid.tsx` | 把恢复参数透传给虚拟化 hook | 修改 |
| `apps/frontend/src/routes/_layout/knowledge.tsx` | 装配：筛选恢复/回写、改筛选回顶部（挂载不归零） | 修改 |
| `apps/frontend/src/hooks/use-knowledge.test.tsx` | 请求不重放回归测试 | 修改 |
| `apps/frontend/src/hooks/use-virtual-grid.test.ts` | 上报与恢复单测 | 修改 |
| `apps/frontend/src/hooks/use-knowledge-view-state.test.ts` | store 单测 | 创建 |
| `apps/frontend/src/components/knowledge/KnowledgeGrid.test.tsx` | 透传断言 | 修改 |
| `apps/frontend/src/routes/_layout/knowledge.test.tsx` | 路由级：筛选恢复、改筛选回顶部 | 创建 |

---

### 任务 1：请求侧改为「保留缓存 + 不重放」

**文件：**

- 修改：`apps/frontend/src/hooks/use-knowledge.ts:208-228`（`useInfiniteKnowledgeBaseList`）、`apps/frontend/src/hooks/use-knowledge.ts:410-434`（`useInfiniteDocumentList`）
- 测试：`apps/frontend/src/hooks/use-knowledge.test.tsx:161-178`（替换上一轮新增的用例）

- [ ] **步骤 1：把上一轮的「卸载释放缓存」用例替换为「重挂载不重放」**

上一轮为 `gcTime: 0` 写的用例与本次目标相反，必须替换。将

```tsx
it('卸载后释放分页缓存，返回时不再重放历史分页', async () => {
  api.listKnowledgeBasesApi.mockResolvedValue(cursorPage([makeBase()], 'c1'));
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(() => useInfiniteKnowledgeBaseList(), {
    wrapper: createWrapperWithClient(client),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(client.getQueryData(defaultListKey())).toBeDefined();

  unmount();

  await waitFor(() =>
    expect(client.getQueryData(defaultListKey())).toBeUndefined(),
  );
});
```

替换为：

```tsx
it('卸载后在 gcTime 内重新挂载不重放历史分页', async () => {
  api.listKnowledgeBasesApi.mockResolvedValue(cursorPage([makeBase()], 'c1'));
  const client = createTestQueryClient();
  const { result, unmount } = renderHook(() => useInfiniteKnowledgeBaseList(), {
    wrapper: createWrapperWithClient(client),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(client.getQueryData(defaultListKey())).toBeDefined();

  unmount();

  // 缓存未到 gcTime：保留而非释放
  expect(client.getQueryData(defaultListKey())).toBeDefined();

  renderHook(() => useInfiniteKnowledgeBaseList(), {
    wrapper: createWrapperWithClient(client),
  });
  // 给潜在的 refetch 留出微/宏任务窗口
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(api.listKnowledgeBasesApi).toHaveBeenCalledTimes(1);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-knowledge.test.tsx` 预期：FAIL。`卸载后在 gcTime 内重新挂载不重放历史分页` 在 `expect(client.getQueryData(defaultListKey())).toBeDefined()`（unmount 之后那处）失败——当前 `gcTime: 0` 已把缓存清掉。

- [ ] **步骤 3：改请求选项**

`useInfiniteKnowledgeBaseList` 中把

```ts
    staleTime: 0,
    // 无订阅即释放缓存：否则切走路由再回来时，useInfiniteQuery 会重放全部已加载分页
    // （已加载 N 页 → 瞬间发 N 次列表请求）
    gcTime: 0,
    refetchOnWindowFocus: false,
```

改为：

```ts
    staleTime: 0,
    // 保留默认 gcTime(5min)：离开 ≤5min 返回命中缓存，>5min 缓存回收后从首页重来。
    // 用 refetchOnMount/refetchOnReconnect 阻止重挂载与断网重连时重放历史分页
    // （useInfiniteQuery 重放会一次发 N 页请求）
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
```

`useInfiniteDocumentList` 中把

```ts
    enabled: !!kbId,
    staleTime: 0,
    // 同知识库列表：离开后释放分页缓存，返回时只请求首页
    gcTime: 0,
    refetchOnWindowFocus: false,
```

改为：

```ts
    enabled: !!kbId,
    staleTime: 0,
    // 同知识库列表：保留缓存但不在重挂载/重连时重放分页
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-knowledge.test.tsx` 预期：PASS，全部用例通过。

---

### 任务 2：虚拟化上报首可见项 + 一次性恢复

**文件：**

- 修改：`apps/frontend/src/hooks/use-virtual-grid.ts`
- 测试：`apps/frontend/src/hooks/use-virtual-grid.test.ts`

- [ ] **步骤 1：编写失败的测试**

在 `use-virtual-grid.test.ts` 的 `virtualizerStub` 中补 `scrollToIndex`：

```ts
const virtualizerStub = {
  getVirtualItems: vi.fn<() => VirtualItemStub[]>(),
  getTotalSize: vi.fn(() => 0),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
};
```

并在 `beforeEach` 中重置它：

```ts
beforeEach(() => {
  vi.clearAllMocks();
  useVirtualizerMock.mockReturnValue(virtualizerStub);
  virtualizerStub.getVirtualItems.mockReturnValue([]);
  virtualizerStub.getTotalSize.mockReturnValue(0);
  virtualizerStub.scrollToIndex.mockReset();
});
```

在文件末尾（`describe` 内）追加用例：

```tsx
it('通过 onChange 上报首可见项索引', () => {
  const onFirstVisibleItemChange = vi.fn();
  renderHook(() =>
    useVirtualGrid({
      scrollElement: null,
      count: 6,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      onFirstVisibleItemChange,
    }),
  );
  const options = useVirtualizerMock.mock.calls[0][0] as {
    onChange: (instance: { getVirtualItems: () => VirtualItemStub[] }) => void;
  };
  options.onChange({ getVirtualItems: () => [makeVirtualItem(4)] });
  expect(onFirstVisibleItemChange).toHaveBeenCalledWith(4);
});

it('挂载时把首可见项恢复到保存的索引', () => {
  const scrollElement = document.createElement('div');
  renderHook(() =>
    useVirtualGrid({
      scrollElement,
      count: 20,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      initialRestoreIndex: 7,
    }),
  );
  expect(virtualizerStub.scrollToIndex).toHaveBeenCalledWith(7, {
    align: 'start',
  });
});

it('只恢复一次，重渲染不重复滚动', () => {
  const scrollElement = document.createElement('div');
  const { rerender } = renderHook(
    ({ count }: { count: number }) =>
      useVirtualGrid({
        scrollElement,
        count,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        initialRestoreIndex: 7,
      }),
    { initialProps: { count: 20 } },
  );
  rerender({ count: 40 });
  expect(virtualizerStub.scrollToIndex).toHaveBeenCalledTimes(1);
});

it('保存位置超出已加载条数时不滚动', () => {
  const scrollElement = document.createElement('div');
  renderHook(() =>
    useVirtualGrid({
      scrollElement,
      count: 20,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      initialRestoreIndex: 42,
    }),
  );
  expect(virtualizerStub.scrollToIndex).not.toHaveBeenCalled();
});

it('保存位置为 0 时不滚动', () => {
  const scrollElement = document.createElement('div');
  renderHook(() =>
    useVirtualGrid({
      scrollElement,
      count: 20,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      initialRestoreIndex: 0,
    }),
  );
  expect(virtualizerStub.scrollToIndex).not.toHaveBeenCalled();
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-virtual-grid.test.ts` 预期：FAIL。`上报首可见项` 报 `options.onChange is not a function`；`恢复到保存索引`/`只恢复一次` 报 `scrollToIndex` 未被调用。

- [ ] **步骤 3：实现**

`use-virtual-grid.ts` 的 `UseVirtualGridOptions` 增加两个可选字段：

```ts
type UseVirtualGridOptions = {
  /** 滚动容器（也是虚拟化的 scrollElement） */
  scrollElement: HTMLElement | null;
  /** 已加载的条目数 */
  count: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** 挂载时一次性恢复到的首可见项索引；仅当 0 < index < count 时生效 */
  initialRestoreIndex?: number;
  /** 首可见项索引变化回调（滚动中持续上报，不触发渲染） */
  onFirstVisibleItemChange?: (index: number) => void;
};
```

导入补 `useRef`、`useLayoutEffect`、`useCallback` 与 `useSyncExternalStore`：

```ts
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
```

函数签名解构补默认值：

```ts
export function useVirtualGrid({
  scrollElement,
  count,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  initialRestoreIndex = 0,
  onFirstVisibleItemChange,
}: UseVirtualGridOptions) {
```

容器宽度改为用 `useSyncExternalStore` 在渲染期读 DOM（**计划修正**见任务末：原稿为 `useState` + ResizeObserver effect）：

```ts
// 容器宽度是「外部可变值」：用 useSyncExternalStore 在渲染期读 DOM。
// 不能用 useState + effect：那样的首次渲染宽度未知，会先绘制一帧 width=0 的
// 零宽单列布局（列表缓存保留后首帧就有数据，这一帧真的会被看见）。
const subscribeWidth = useCallback(
  (onChange: () => void) => {
    if (!scrollElement) return () => {};
    const observer = new ResizeObserver(() => onChange());
    observer.observe(scrollElement);
    return () => observer.disconnect();
  },
  [scrollElement],
);
const getWidth = useCallback(
  () => (scrollElement ? scrollElement.clientWidth : 0),
  [scrollElement],
);
const width = useSyncExternalStore(subscribeWidth, getWidth);

const layout = useMemo(() => computeGridLayout(width), [width]);
```

之后加入回调 ref：

```ts
// 回调经 ref 持有：避免每次渲染传入新的函数引用导致虚拟化器 options 抖动，
// 同时保证 onChange 触发时拿到的是最新回调
const onFirstVisibleItemChangeRef = useRef(onFirstVisibleItemChange);
useEffect(() => {
  onFirstVisibleItemChangeRef.current = onFirstVisibleItemChange;
}, [onFirstVisibleItemChange]);
```

`useVirtualizer` 入参补 `onChange`：

```ts
const virtualizer = useVirtualizer({
  count,
  getScrollElement: () => scrollElement,
  // 关闭库内部的 flushSync：恢复在 layout effect 里调用 scrollToIndex，库默认会在同步
  // 通知路径上 flushSync 重渲染（React 提交阶段嵌套同步渲染）→ 控制台报
  // "flushSync was called from inside a lifecycle method" 且每次同步重渲染整窗卡片导致卡顿
  useFlushSync: false,
  estimateSize: () => CARD_ESTIMATED_HEIGHT + GRID_GAP,
  lanes: layout.columns,
  overscan: 3,
  // 动态高度：容器内每个卡片真实测量；jsdom 等无布局环境测量为 0 时回退到估算值
  measureElement: (element) => {
    const measured = element.getBoundingClientRect().height;
    return measured > 0 ? measured : CARD_ESTIMATED_HEIGHT + GRID_GAP;
  },
  // 首可见项索引是「返回恢复」的锚点：索引与 DOM 高度解耦，落点不受重新测量影响。
  // 不能用 getVirtualItems()[0]——默认 rangeExtractor 会把 overscan 项也算进来，
  // 上报值会比真实首可见项小 overscan，往返会累积向上漂移
  onChange: (instance) => {
    const offset = instance.scrollOffset ?? 0;
    const first = instance
      .getVirtualItems()
      .find((item) => item.start >= offset);
    if (first) onFirstVisibleItemChangeRef.current?.(first.index);
  },
});
```

在触底预取 effect 之前加入一次性恢复 effect：

```ts
// 一次性恢复：挂载后（容器就绪且有数据）若保存位置在当前数据范围内则滚过去，
// 否则保持顶部。restoredRef 保证只执行一次（同时吸收 StrictMode 双跑）。
// 用 useLayoutEffect 在绘制前完成跳转，避免「先绘制顶部再跳转」的首帧跳动。
const restoredRef = useRef(false);
useLayoutEffect(() => {
  if (restoredRef.current) return;
  if (!scrollElement || count === 0) return;
  restoredRef.current = true;
  if (initialRestoreIndex > 0 && initialRestoreIndex < count) {
    virtualizer.scrollToIndex(initialRestoreIndex, { align: 'start' });
  }
}, [scrollElement, count, initialRestoreIndex, virtualizer]);
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-virtual-grid.test.ts` 预期：PASS（原有 5 个 + 新增 5 个）。

> **计划修正（审查返工）：** 原稿上报 `getVirtualItems()[0]?.index ?? 0` 会把 overscan 计入锚点（默认 range extractor 的 `start = max(range.startIndex - overscan, 0)`，本 hook `overscan: 3`），导致「离开→返回」位置**累积向上漂移**；改为上报首个 `start >= scrollOffset` 的虚拟项索引（无可见项则不上报）。恢复 effect 由 `useEffect` 改为 `useLayoutEffect`，消除「先绘制顶部再跳转」的首帧跳动。测试相应补 4 个用例：剔除 overscan、无可见项不上报、回调经 ref 转发取到最新回调（用首帧 options 触发）、`initialRestoreIndex === count` 边界不滚动，本任务测试总数为 **14**（原有 5 + 新增 9）。

> **计划修正（宽度来源返工）：** 宽度来源由 `useState` + ResizeObserver effect（`useLayoutEffect` 内同步读一次 `clientWidth` 再挂 RO）改为 `useSyncExternalStore`（`getSnapshot` 在**渲染期**读 `scrollElement.clientWidth`）：原写法首帧宽度未知，会先绘制一帧 `width=0` 的零宽单列布局（列表缓存保留后首帧就有数据，这一帧真的会被看见），且在 effect 内同步 `setState` 触发 `react-x/set-state-in-effect` 警告。恢复 effect 的守卫随之回退为只判 `scrollElement` 与 `count`（宽度在渲染期已确定，无需再等），依赖数组去掉 `width`；测试补一条「ResizeObserver 触发后按新宽度重算 lanes」用例（局部覆写 `ResizeObserver` 桩驱动 subscribe → onChange 分支，并断言 unsubscribe 已 disconnect），本任务测试总数为 **16**（原有 5 + 新增 11）。

---

### 任务 3：会话内视图状态 store

**文件：**

- 创建：`apps/frontend/src/hooks/use-knowledge-view-state.ts`
- 测试：`apps/frontend/src/hooks/use-knowledge-view-state.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `apps/frontend/src/hooks/use-knowledge-view-state.test.ts`：

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useKnowledgeViewState } from './use-knowledge-view-state';

describe('useKnowledgeViewState', () => {
  it('写入后再次挂载能读回筛选与首可见项索引', () => {
    const first = renderHook(() => useKnowledgeViewState());
    act(() => {
      first.result.current.saveFilter({ name: '产品', visibility: 'private' });
      first.result.current.saveFirstVisibleIndex(42);
    });
    first.unmount();

    const second = renderHook(() => useKnowledgeViewState());
    expect(second.result.current.initialFilter).toEqual({
      name: '产品',
      visibility: 'private',
    });
    expect(second.result.current.initialRestoreIndex).toBe(42);
  });

  it('挂载期间的上报不改变已冻结的待恢复索引', () => {
    const { result } = renderHook(() => useKnowledgeViewState());
    const frozen = result.current.initialRestoreIndex;

    act(() => {
      result.current.saveFirstVisibleIndex(99);
    });

    expect(result.current.initialRestoreIndex).toBe(frozen);
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-knowledge-view-state.test.ts` 预期：FAIL，报错 `Failed to resolve import "./use-knowledge-view-state"`。

- [ ] **步骤 3：实现**

创建 `apps/frontend/src/hooks/use-knowledge-view-state.ts`：

```ts
import type { KnowledgeBaseVisibility } from '@/api/types';
import { useCallback, useState } from 'react';

/** 视图筛选条件：与列表查询过滤条件同形，undefined 表示「不筛」 */
export type KnowledgeViewFilter = {
  name?: string;
  visibility?: KnowledgeBaseVisibility;
};

type KnowledgeViewState = {
  filter: KnowledgeViewFilter;
  firstVisibleIndex: number;
};

// 模块级：仅存活于当前 SPA 会话（F5 清空）。
// 之所以不落 URL / storage，是因为侧边栏「知识库」入口指向不带 query 的 /knowledge，
// 且约定「刷新后不恢复」——内存态与这两点都一致。
let state: KnowledgeViewState = {
  filter: {},
  firstVisibleIndex: 0,
};

/**
 * 知识库列表的会话内视图状态。
 * 挂载瞬间冻结 initialFilter / initialRestoreIndex：挂载初期虚拟化器会上报 index=0，
 * 若每次渲染都读 store，会把待恢复目标覆盖掉。
 */
export function useKnowledgeViewState() {
  const [initialFilter] = useState(() => state.filter);
  const [initialRestoreIndex] = useState(() => state.firstVisibleIndex);

  const saveFilter = useCallback((patch: KnowledgeViewFilter) => {
    state = { ...state, filter: { ...state.filter, ...patch } };
  }, []);

  const saveFirstVisibleIndex = useCallback((index: number) => {
    state = { ...state, firstVisibleIndex: index };
  }, []);

  return {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  };
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test --run src/hooks/use-knowledge-view-state.test.ts` 预期：PASS（2 个用例）。

---

### 任务 4：KnowledgeGrid 透传恢复参数

**文件：**

- 修改：`apps/frontend/src/components/knowledge/KnowledgeGrid.tsx`
- 测试：`apps/frontend/src/components/knowledge/KnowledgeGrid.test.tsx`

- [ ] **步骤 1：编写失败的测试**

`KnowledgeGrid.test.tsx` 的 `virtualizerStub` 补 `scrollToIndex`：

```ts
const virtualizerStub = {
  getVirtualItems: vi.fn(),
  getTotalSize: vi.fn(() => 0),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
};
```

在 `beforeEach` 中补重置：

```ts
virtualizerStub.getVirtualItems.mockReturnValue([]);
virtualizerStub.getTotalSize.mockReturnValue(0);
virtualizerStub.scrollToIndex.mockReset();
```

在 `describe` 内追加用例：

```tsx
it('把 initialRestoreIndex 透传给虚拟化并滚动到保存位置', () => {
  const items = [makeKb('kb1', '知识库 A'), makeKb('kb2', '知识库 B')];
  renderGrid({
    scrollElement: document.createElement('div'),
    items,
    hasNextPage: false,
    initialRestoreIndex: 1,
  });
  expect(virtualizerStub.scrollToIndex).toHaveBeenCalledWith(1, {
    align: 'start',
  });
});

it('把首可见项变化回调透传给虚拟化', () => {
  const items = [makeKb('kb1', '知识库 A')];
  const onFirstVisibleItemChange = vi.fn();
  renderGrid({
    scrollElement: document.createElement('div'),
    items,
    hasNextPage: false,
    onFirstVisibleItemChange,
  });
  const options = useVirtualizerMock.mock.calls[0][0] as {
    onChange: (instance: { getVirtualItems: () => unknown[] }) => void;
  };
  options.onChange({
    getVirtualItems: () => [{ index: 0, start: 0, size: 200, lane: 0, key: 0 }],
  });
  expect(onFirstVisibleItemChange).toHaveBeenCalledWith(0);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test --run src/components/knowledge/KnowledgeGrid.test.tsx` 预期：FAIL。`initialRestoreIndex` / `onFirstVisibleItemChange` 不在 `GridProps` 上，TypeScript 报 `Property 'initialRestoreIndex' does not exist`（vitest 转译不检查类型时，则表现为 `scrollToIndex`/回调未被调用的断言失败）。

- [ ] **步骤 3：实现**

`KnowledgeGrid.tsx` 的 `KnowledgeGridProps` 增加：

```ts
  /** 挂载时一次性恢复到的首可见项索引（来自会话内视图状态） */
  initialRestoreIndex?: number;
  /** 首可见项索引变化回调（滚动中持续上报） */
  onFirstVisibleItemChange?: (index: number) => void;
```

`KnowledgeGridVirtual` 解构补两个属性并传给 `useVirtualGrid`：

```tsx
const KnowledgeGridVirtual: FC<KnowledgeGridProps> = ({
  scrollElement,
  items,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  initialRestoreIndex,
  onFirstVisibleItemChange,
}) => {
  const { layout, virtualItems, totalSize, measureElement } = useVirtualGrid({
    scrollElement,
    count: items.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    initialRestoreIndex,
    onFirstVisibleItemChange,
  });
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test --run src/components/knowledge/KnowledgeGrid.test.tsx` 预期：PASS（原有 7 个 + 新增 2 个）。

---

### 任务 5：路由装配

**文件：**

- 修改：`apps/frontend/src/routes/_layout/knowledge.tsx`
- 修改：`apps/frontend/src/components/knowledge/KnowledgeToolbar.tsx`（新增可选 `defaultKeyword` 并作为搜索框 `defaultValue`，见步骤 3 后的「计划修正」）
- 测试：创建 `apps/frontend/src/routes/_layout/knowledge.test.tsx`
- 测试：修改 `apps/frontend/src/components/knowledge/KnowledgeToolbar.test.tsx`（`renderToolbar` 透传 `defaultKeyword` + 新增回显用例）

- [ ] **步骤 1：编写失败的测试**

创建 `apps/frontend/src/routes/_layout/knowledge.test.tsx`：

```tsx
import { KnowledgeGrid } from '@/components/knowledge/KnowledgeGrid.tsx';
import { useInfiniteKnowledgeBaseList } from '@/hooks/use-knowledge';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import type { FC } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as KnowledgeRoute } from './knowledge';

vi.mock('@/hooks/use-knowledge', () => ({
  useInfiniteKnowledgeBaseList: vi.fn(),
  useCreateKnowledgeBase: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useUpdateKnowledgeBase: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useLikeKnowledgeBase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUnlikeKnowledgeBase: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteKnowledgeBase: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock('@/components/knowledge/KnowledgeGrid.tsx', () => ({
  KnowledgeGrid: vi.fn(() => null),
}));

vi.mock('@/hooks/use-knowledge-view-state', () => ({
  useKnowledgeViewState: vi.fn(),
}));

const mockedList = vi.mocked(useInfiniteKnowledgeBaseList);
const mockedGrid = vi.mocked(KnowledgeGrid);
const mockedViewState = vi.mocked(useKnowledgeViewState);

function noopQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteKnowledgeBaseList>;
}

/** 控制 store 的冻结值，返回写回 spy 以便断言 */
function mockViewState(
  initialFilter: { name?: string; visibility?: 'private' | 'public' } = {},
  initialRestoreIndex = 0,
) {
  const saveFilter = vi.fn();
  const saveFirstVisibleIndex = vi.fn();
  mockedViewState.mockReturnValue({
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  });
  return { saveFilter, saveFirstVisibleIndex };
}

function renderRoute() {
  const C = KnowledgeRoute.options.component as FC;
  return render(
    <AntdApp>
      <C />
    </AntdApp>,
  );
}

/** 最近一次传给 KnowledgeGrid 的 props（React 可能以 (props, context) 调用） */
function lastGridProps() {
  return mockedGrid.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

/** 点击 Input.Search 的搜索按钮（antd 会把按钮文字渲染成带空格的「搜 索」） */
async function submitSearch(value: string) {
  await userEvent.type(screen.getByPlaceholderText('按名称搜索知识库'), value);
  const searchButton = screen
    .getAllByRole('button')
    .find((b) => b.querySelector('[aria-label="search"]'));
  if (!searchButton) throw new Error('未找到搜索按钮');
  await userEvent.click(searchButton);
}

describe('routes/_layout/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedList.mockReturnValue(noopQuery());
    mockedGrid.mockReturnValue(null);
  });

  it('用 store 中冻结的筛选与恢复索引初始化（返回恢复的入口）', () => {
    const { saveFirstVisibleIndex } = mockViewState(
      { name: '产品', visibility: 'private' },
      7,
    );

    renderRoute();

    expect(mockedList).toHaveBeenLastCalledWith({
      name: '产品',
      visibility: 'private',
    });
    expect(lastGridProps()).toMatchObject({
      initialRestoreIndex: 7,
      onFirstVisibleItemChange: saveFirstVisibleIndex,
      hasFilter: true,
    });
  });

  it('改变筛选时把新筛选写回 store', async () => {
    const { saveFilter } = mockViewState();
    renderRoute();

    await submitSearch('产品');
    expect(saveFilter).toHaveBeenCalledWith({ name: '产品' });

    await userEvent.click(screen.getByText('公开'));
    expect(saveFilter).toHaveBeenCalledWith({ visibility: 'public' });
  });

  it('清空筛选时写回 undefined（空关键词 / 全部）', async () => {
    const { saveFilter } = mockViewState({ name: '产品' });
    renderRoute();

    const input = screen.getByPlaceholderText('按名称搜索知识库');
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(saveFilter).toHaveBeenCalledWith({ name: undefined });

    await userEvent.click(screen.getByText('公开'));
    await userEvent.click(screen.getByText('全部'));
    expect(saveFilter).toHaveBeenLastCalledWith({ visibility: undefined });
  });

  it('挂载不归零，改筛选才回到列表顶部', async () => {
    mockViewState();
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    renderRoute();

    expect(scrollTo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('公开'));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));

    scrollTo.mockRestore();
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test --run src/routes/_layout/knowledge.test.tsx` 预期：FAIL。最初的 3 个用例全红（第 4 个用例「清空筛选时写回 undefined」是实施期补充，见文末计划修正）。`用 store 中冻结的筛选与恢复索引初始化` —— 组件还没读 store，`useInfiniteKnowledgeBaseList` 收到的是 `{ name: undefined, visibility: undefined }`，且 `KnowledgeGrid` 的 props 里没有 `initialRestoreIndex`；`改变筛选时把新筛选写回 store` —— 当前 `onVisibilityChange={setVisibility}` / `onSearch={setCommittedName}` 直接接 state setter，`saveFilter` 从未被调用；`挂载不归零` —— 当前 effect 依赖 `[filter, scrollElement]`，`scrollElement` 由 `null` 变为元素即触发归零，挂载期就调用了 `scrollTo({ top: 0 })`。

- [ ] **步骤 3：实现装配**

把 `knowledge.tsx` 顶部 import 改为：

```tsx
import { KnowledgeGrid } from '@/components/knowledge/KnowledgeGrid.tsx';
import {
  KnowledgeToolbar,
  type VisibilityFilter,
} from '@/components/knowledge/KnowledgeToolbar.tsx';
import { useKnowledgeViewState } from '@/hooks/use-knowledge-view-state.ts';
import {
  type KnowledgeListFilter,
  useInfiniteKnowledgeBaseList,
} from '@/hooks/use-knowledge.ts';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
```

> 注：`@/hooks/*` 两条 import 的顺序由 `prettier-plugin-organize-imports` 决定（`use-knowledge-view-state.ts` 排在 `use-knowledge.ts` 之前），与「人肉按语义排列」无关；顺序反了 `lint` 会报 prettier 错误。

组件内筛选初值与回写、以及新的「改筛选回顶部」effect：

```tsx
function KnowledgeComponent() {
  const {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  } = useKnowledgeViewState();

  // 初值来自会话 store：SPA 返回时自动还原上次筛选
  const [committedName, setCommittedName] = useState(initialFilter.name ?? '');
  const [visibility, setVisibility] = useState<VisibilityFilter>(
    initialFilter.visibility ?? 'all',
  );
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );

  const filter = useMemo<KnowledgeListFilter>(
    () => ({
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const query = useInfiniteKnowledgeBaseList(filter);
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.list) ?? [],
    [query.data],
  );

  const filterKey = `${committedName}|${visibility}`;
  const prevFilterKeyRef = useRef(filterKey);

  // 只在筛选真正变化时回顶部。挂载时不动：挂载归零会与首可见项恢复互相打架
  useEffect(() => {
    if (prevFilterKeyRef.current === filterKey) return;
    prevFilterKeyRef.current = filterKey;
    scrollElement?.scrollTo({ top: 0 });
  }, [filterKey, scrollElement]);

  const handleSearch = (value: string) => {
    setCommittedName(value);
    saveFilter({ name: value || undefined });
  };

  const handleVisibilityChange = (value: VisibilityFilter) => {
    setVisibility(value);
    saveFilter({ visibility: value === 'all' ? undefined : value });
  };

  return (
    <div className="flex h-full flex-col">
      <KnowledgeToolbar
        visibility={visibility}
        onVisibilityChange={handleVisibilityChange}
        onSearch={handleSearch}
      />
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto">
        <KnowledgeGrid
          scrollElement={scrollElement}
          items={items}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          refetch={query.refetch}
          hasFilter={Boolean(filter.name || filter.visibility)}
          initialRestoreIndex={initialRestoreIndex}
          onFirstVisibleItemChange={saveFirstVisibleIndex}
        />
      </div>
    </div>
  );
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test --run src/routes/_layout/knowledge.test.tsx` 预期：PASS（4 个用例）。

> 说明：`挂载不归零` 依赖 `Element.prototype.scrollTo` 全局桩（`src/test/setup.ts` 已提供）。若挂载期出现与本次无关的 `scrollTo` 调用导致该断言失败，改为在 `renderRoute()` 之后调用 `scrollTo.mockClear()`，仅断言「改筛选后调用过」。

> **计划修正（实施返工）：** 原稿的路由测试依赖模块级 store 的跨用例残留——用例 2 期望 `{ name: undefined, ... }`，但用例 1 已把 `'产品'` 写进 store，重新挂载时会被恢复；用例 3 点击「公开」时 store 里的 `visibility` 已是 `'public'`，`filterKey` 不变、回顶部 effect 不触发，`waitFor` 必然超时。这类顺序依赖使测试既不稳定也不验证本任务新增的接线。改为 mock `@/hooks/use-knowledge-view-state` 与 `@/components/knowledge/KnowledgeGrid.tsx`，逐用例注入冻结的 `initialFilter` / `initialRestoreIndex` 并断言路由自身的接线（筛选初值 → 查询入参、写回 → `saveFilter`、`KnowledgeGrid` 收到的两个恢复参数），得到确定性边界：store 语义由任务 3 单测覆盖，端到端「返回恢复 / 零重放请求」由任务 6 的真实浏览器实测覆盖。实施中还补了第 4 个用例「清空筛选时写回 undefined（空关键词 / 全部）」：`value || undefined` 与 `value === 'all' ? undefined : value` 这两处归一化只存在于路由层，任务 3 的 store 单测覆盖不到；已用变异验证其非空转——去掉归一化后该用例转红（收到 `{ name: '' }`，期望 `{ name: undefined }`）。

> **计划修正（审查返工）：** 原稿只要求「筛选初值取自 `initialFilter`」，漏掉了**恢复的关键词回显**：可见性是受控 `Segmented`（`value={visibility}`）天然回显，关键词却是非受控 `Input.Search`（无 `value` 也无 `defaultValue`），于是返回恢复后出现「列表已按 `'产品'` 过滤、搜索框却为空」的产品不一致。修法：`KnowledgeToolbarProps` 增加可选 `defaultKeyword?: string`，挂到 `<Input.Search defaultValue={defaultKeyword}>`（保持 `allowClear` / `placeholder` / `onSearch={(v) => onSearch(v.trim())}` 与「提交才生效」的既有交互不变，不改受控），路由传 `defaultKeyword={initialFilter.name ?? ''}`。覆盖：`KnowledgeToolbar.test.tsx` 新增「`defaultKeyword` 作为搜索框初始值（返回恢复）」用例，`knowledge.test.tsx` 首个用例补 `expect(screen.getByPlaceholderText('按名称搜索知识库')).toHaveValue('产品')`。同批测试卫生修复：(1) `vi.clearAllMocks()` 只清调用历史不清实现，`mockedViewState.mockReturnValue(...)` 会跨用例残留，在 `beforeEach` 末尾补默认 `mockViewState()`（各用例仍可再调一次，最后一次生效；不用 `vi.resetAllMocks()`——它会连 `vi.mock` 工厂里的实现一起清掉，致 `useCreateKnowledgeBase()` 返回 `undefined` 使工具栏崩溃）；(2) 「挂载不归零，改筛选才回到列表顶部」的 `scrollTo.mockRestore()` 移入 `finally`，避免断言中途失败泄漏 spy 污染同文件后续用例。

---

### 任务 6：全量验证

**文件：** 无（仅验证）

- [ ] **步骤 1：类型检查**

运行：`pnpm --filter @lucy/frontend typecheck` 预期：无输出（通过）。

- [ ] **步骤 2：Lint**

运行：`pnpm --filter @lucy/frontend lint` 预期：0 error。允许存在与本次无关的既有 warning（`components/bits/fold-text.tsx`、`components/ui/glass-button.tsx`）。

- [ ] **步骤 3：全量前端测试**

运行：`pnpm --filter @lucy/frontend test --run` 预期：全部测试文件 PASS。

- [ ] **步骤 4：Chrome MCP 实测（关键路径）**

前置：dev 栈已起（`5173` 前端 / `3000` 后端 / `5432` PG / `6379` Redis），浏览器已登录。

1. 打开 `http://localhost:5173/knowledge`，用 `evaluate_script` 给 `window.fetch` 打点，记录含 `/knowledge` 的请求；
2. 点可见性「私有」，滚动容器滚到底若干次（加载 ≥2 页），记录当前首可见项文本；
3. 点侧边栏「关于」→ 点侧边栏「知识库」；
4. 断言：可见性仍为「私有」、**列表请求次数为 0**、滚动位置回到离开前的首可见项附近（允许 ±1 项）。

预期：筛选还原、零请求、位置还原。

- [ ] **步骤 5：Chrome MCP 实测（缓存回收路径）**

1. 在知识库页加载 ≥2 页后，用 `evaluate_script` 通过应用可访问的 QueryClient 清掉列表缓存（若 QueryClient 未暴露到 window，改为直接刷新页面模拟缓存丢失）；
2. 断言：列表回到顶部，且仅发 **1** 次 `?limit=20` 请求（无 cursor 追补）。

预期：只请首页，无连续请求。

---

### 任务 7：统一整理提交

**文件：** 无（仅版本控制操作）

- [ ] **步骤 1：检查工作区**

运行：`git status --short`、`git diff --stat` 预期：确认在途的游标分页改动与本次返回恢复改动的边界。

- [ ] **步骤 2：按语义分组提交**

按文件路径显式 `git add`，分为独立提交（示例，实际以当时 diff 为准）：

```bash
git add apps/backend/src/knowledge packages/shared/src/index.ts packages/shared/src/generated/openapi.ts
git commit -F <写在 %TEMP% 的消息文件>   # refactor(backend): 知识库列表改游标分页

git add apps/frontend/src/hooks/use-knowledge.ts apps/frontend/src/hooks/use-virtual-grid.ts apps/frontend/src/components/knowledge apps/frontend/src/routes/_layout/knowledge.tsx apps/frontend/src/api/knowledge.ts apps/frontend/package.json
git commit -F <写在 %TEMP% 的消息文件>   # feat(frontend): 知识库虚拟化网格 + 返回恢复

git add docs/superpowers/specs/2026-09-12-knowledge-scroll-restore-design.md docs/superpowers/plans/2026-09-12-knowledge-scroll-restore.md
git commit -F <写在 %TEMP% 的消息文件>   # docs(knowledge): 返回恢复设计与实现计划
```

注意（Windows + cmd）：`git commit -F -` 的 heredoc 不可用，提交消息先写入 `%TEMP%` 下的文件再 `-F <path>`。每条消息末尾追加：

```
Co-authored-by: CommandCodeBot <noreply@commandcode.ai>
```

- [ ] **步骤 3：确认钩子通过**

预期：`pre-commit`（typegen → lint-staged → typecheck → test）全部通过；若失败，修到通过再提交。

---

## 自检

**规格覆盖度**

| 规格条目 | 对应任务 |
| --- | --- |
| §2.2 删除 `gcTime: 0`、加 `refetchOnMount/refetchOnReconnect` | 任务 1 |
| §2.3 缓存保留默认 5 分钟 | 任务 1（不设 gcTime）+ 任务 6 步骤 5 |
| §2.4 筛选存模块级内存 | 任务 3 + 任务 5 |
| §2.5 缓存不足退回顶部 | 任务 2（`initialRestoreIndex < count` 守卫） |
| §2.6 恢复只在挂载时，页内改筛选回顶部 | 任务 5（`prevFilterKeyRef`） |
| §3.1 请求选项 | 任务 1 |
| §3.2 虚拟化两个入参 + 一次性恢复 | 任务 2 |
| §3.3 视图状态 store（冻结语义） | 任务 3 |
| §3.4 路由装配 | 任务 5 |
| §3.5 KnowledgeGrid 透传 | 任务 4 |
| §5 边界（StrictMode / 索引错位 / 非目标） | 任务 2（`restoredRef`）+ 任务 6 |
| §6 测试 | 任务 1–5 的测试步骤 |
| §7 风险 | 任务 6 步骤 4/5 实测覆盖 |

**类型一致性**

- `KnowledgeViewFilter`（任务 3）字段为 `name?: string` / `visibility?: KnowledgeBaseVisibility`，与 `KnowledgeListFilter` 同形；任务 5 中 `initialFilter.visibility ?? 'all'` 赋给 `VisibilityFilter`（`'all' | KnowledgeBaseVisibility`）成立。
- `useVirtualGrid` 的 `initialRestoreIndex?: number` / `onFirstVisibleItemChange?: (index: number) => void`（任务 2）与 `KnowledgeGridProps` 中同名属性（任务 4）、路由传入值（任务 5，`initialRestoreIndex: number`、`saveFirstVisibleIndex: (index: number) => void`）一致。
- 任务 2 暴露的 `scrollToIndex(index, { align })` 签名与 `@tanstack/virtual-core` 3.17.10 的 `scrollToIndex(index, options?: ScrollToIndexOptions)` 一致。

**占位符扫描：** 无「待定 / TODO / 后续实现」；`%TEMP% 消息文件` 是 Windows 下 heredoc 不可用时的既有提交约定（见仓库品味记录），非占位符。

**已知偏差：** 本计划未按技能默认在每个任务后 commit，原因见开头「提交说明」——工作区存在在途改动且 `pre-commit` 会强制 stage 生成契约文件；已改为任务 7 统一分组提交。
