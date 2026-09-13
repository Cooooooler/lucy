# 知识库列表「返回恢复」设计（筛选 + 分页缓存 + 滚动位置）

- 日期：2026-09-12
- 状态：待实施
- 分支：feature/knowledge
- 涉及：`apps/frontend`（`routes/_layout/knowledge.tsx`、`hooks/use-virtual-grid.ts`、`hooks/use-knowledge.ts`、新增 `hooks/use-knowledge-view-state.ts`、`components/knowledge/KnowledgeGrid.tsx`）

## 1. 背景与目标

上一轮修复消除了「滚动加载多页后切走路由、返回时瞬间重放 N 次列表请求」的问题，做法是把无限查询的 `gcTime` 设为 `0`：切走即释放分页缓存，返回只请求首页。代价是**返回后列表回到顶部、已加载分页全部丢失**。

目标：在**不重新引入请求风暴**的前提下，让 SPA 返回知识库时恢复：筛选条件（关键词 / 可见性）、已加载分页、滚动位置。

非目标（明确不做，YAGNI）：

- 跨整页刷新（F5）恢复：刷新后筛选与位置清空，回到顶部并请求首页。
- 缓存不足时追补分页。

## 2. 决策记录

### 2.1 用虚拟索引而非像素 `scrollTop` 记录位置

列表用 `@tanstack/react-virtual` 虚拟化，卡片高度是 `measureElement` 动态测量、列数随宽度变化（`lanes`）。像素偏移在返回后因重新测量而漂移，落点不准。记录**首可见项索引**并用 `virtualizer.scrollToIndex(index, { align: 'start' })` 恢复，位置与 DOM 高度解耦。

### 2.2 用 `refetchOnMount: false` 取代 `gcTime: 0` 作为防重放机制

请求风暴的根因是 `useInfiniteQuery` 在数据 stale 时重挂载会**顺序重放全部已缓存分页**，而 `staleTime: 0` 使数据永远 stale。因此只要缓存还在，就必须阻止重挂载 revalidate：

- 删除上一轮加入的 `gcTime: 0`（回到默认 5 分钟），让缓存得以保留；
- 显式 `refetchOnMount: false` + `refetchOnReconnect: false`，使「重挂载」与「断网重连」都不重放分页。

`refetchOnReconnect` 必须一并关闭：默认 `true`，在 `staleTime: 0` 下断网重连同样会重放全部页，属于同一类风暴。

### 2.3 缓存保留沿用默认 `gcTime`（5 分钟）

不做自定义 TTL。语义自然形成两条路径：

| 离开时长 | 缓存状态 | 返回行为                       |
| -------- | -------- | ------------------------------ |
| ≤ 5 分钟 | 保留     | 零请求，恢复筛选 + 分页 + 位置 |
| > 5 分钟 | 被回收   | 1 次首页请求，回到顶部         |

第二条无需额外代码：缓存没了，查询从零开始。这同时保证了**任何路径都不会出现连续请求**。

### 2.4 筛选状态放模块级内存，不放 URL

侧边栏「知识库」入口指向不含 query 的 `/knowledge`，若筛选放 URL，点侧边栏返回会把筛选清空（需额外让侧边栏带参，且 F5 会保留筛选，与「不含 F5」的范围不符）。因此筛选与位置统一放**模块级内存 store**：SPA 会话内有效，F5 清空——与选定范围完全一致。

代价：URL 不体现筛选，无法分享筛选视图，浏览器前进/后退不切换筛选。

### 2.5 缓存不足时退回顶部，不追补分页

若保存位置 `>=` 当前已加载条数（缓存被回收，或数据被删减到该位置之前），则不滚动、从顶部开始。**不做**「连续 `fetchNextPage` 直到够位」——那正是本轮要避免的请求风暴。

### 2.6 恢复只发生在路由重新挂载时

页内主动改筛选（搜索 / 切换可见性）仍沿用现有行为回到顶部，不做「按筛选组合各自记住位置」。理由：单槽位 store 已覆盖「返回」语义，按筛选组合记忆会让「切回某个筛选时突然落到中间」变得反直觉，且需要 per-key 存储与更多边界处理。

## 3. 实现

### 3.1 请求选项（`hooks/use-knowledge.ts`）

`useInfiniteKnowledgeBaseList` 与 `useInfiniteDocumentList` 统一改为：

```ts
staleTime: 0,
// 缓存保留默认 gcTime(5min)：离开 ≤5min 返回零请求；
// 用 refetchOnMount/refetchOnReconnect 阻止重挂载与重连时重放历史分页
refetchOnMount: false,
refetchOnReconnect: false,
refetchOnWindowFocus: false,
```

移除上一轮为 `gcTime: 0` 写的注释。

### 3.2 虚拟化（`hooks/use-virtual-grid.ts`）

新增两个可选入参：

```ts
type UseVirtualGridOptions = {
  // ...现有
  /** 挂载时一次性恢复到的首可见项索引；仅当 0 < index < count 时生效 */
  initialRestoreIndex?: number;
  /** 首可见项索引变化回调（滚动中持续上报，不触发渲染） */
  onFirstVisibleItemChange?: (index: number) => void;
};
```

- 回调经 ref 持有，避免每次渲染传入新的函数引用导致虚拟化器 options 抖动，同时保证 `onChange` 触发时拿到的是最新回调；
- 通过 `useVirtualizer({ onChange })` 上报**首个 `start >= scrollOffset` 的项索引**（即首个未被滚过的行中索引最小的项，**不含 `overscan`**）；无可见项时不上报。注意它不是字面意义的「视口内第一个可见项」：视口顶被某一行切穿时，上报的是**下一行**——残差有界（≤ 1 行，即最多 `lanes` 个条目）且为不动点（恢复后 `scrollOffset === 该项的 start`，同一规则再上报仍是同一项），因此不会累积。**不能**用 `getVirtualItems()[0]?.index ?? 0`：默认 range extractor 会把 `overscan` 项一并算入虚拟项（`start = max(range.startIndex - overscan, 0)`），上报值会比真实首可见项小 `overscan`（本 hook 为 3），`scrollToIndex(值, { align: 'start' })` 会让视图上移约 3 项，且每次「离开→返回」累积向上漂移；
- 恢复副作用：`scrollElement` 就绪且 `count > 0` 时执行一次（`restoredRef` 守卫），满足 `0 < initialRestoreIndex < count` 才 `scrollToIndex(index, { align: 'start' })`；不满足则不滚动（本次挂载的容器本就是新的，`scrollTop` 为 0，即顶部）；
- 恢复副作用用 `useLayoutEffect` 而非 `useEffect`：在同一 commit 内虚拟化器的 layout effect（`useVirtualizerBase` 的 `_didMount`/`_willUpdate`，注册于本 hook 更早的调用位置）已完成 `observeElementRect`，`scrollRect` 就绪，跳转发生在浏览器绘制之前，避免「先绘制顶部再跳转」的首帧跳动。

### 3.3 视图状态 store（新增 `hooks/use-knowledge-view-state.ts`）

```ts
export type KnowledgeViewFilter = {
  name: string;
  visibility: VisibilityFilter; // 'all' | 'private' | 'public'
};

// 模块级：仅存活于当前 SPA 会话（F5 清空），与「恢复仅发生在路由返回」的范围一致
let state = {
  filter: { name: '', visibility: 'all' } as KnowledgeViewFilter,
  firstVisibleIndex: 0,
};

export function useKnowledgeViewState() {
  // 挂载瞬间冻结：用 useState 初始化器读一次，保证挂载期间的上报不会污染待恢复目标
  const [initialFilter] = useState(() => state.filter);
  const [initialRestoreIndex] = useState(() => state.firstVisibleIndex);
  const saveFilter = useCallback(/* 合并写回 state.filter */);
  const saveFirstVisibleIndex = useCallback(/* 写回 state.firstVisibleIndex */);
  return {
    initialFilter,
    initialRestoreIndex,
    saveFilter,
    saveFirstVisibleIndex,
  };
}
```

索引的**冻结**是正确性关键：挂载初期虚拟化器会上报 `index = 0`，若直接读 store 会覆盖待恢复目标。

### 3.4 装配（`routes/_layout/knowledge.tsx`）

- 筛选初值取自 `initialFilter`（`useState` 初始化器）；
- `KnowledgeToolbar` 的 `onSearch` / `onVisibilityChange` 除更新 state 外，调用 `saveFilter` 写回 store；
- **恢复的关键词必须回显到搜索框**：工具栏新增可选 `defaultKeyword`，作为非受控 `Input.Search` 的 `defaultValue`（路由传 `initialFilter.name ?? ''`），与可见性 `Segmented` 的受控 `value` 对称。否则会出现「列表已按关键词过滤但搜索框为空」的不一致，用户会误以为列表坏了。保持该输入框「提交才生效」的既有交互，因此不做受控回填；
- 把 `initialRestoreIndex`、`onFirstVisibleItemChange={saveFirstVisibleIndex}` 透传给 `KnowledgeGrid`；
- 「筛选变化回顶部」副作用改为**仅在 `filterKey` 真正变化时**执行：

```ts
const filterKey = `${committedName}|${visibility}`;
const prevFilterKeyRef = useRef(filterKey);
useEffect(() => {
  if (prevFilterKeyRef.current === filterKey) return;
  prevFilterKeyRef.current = filterKey;
  scrollElement?.scrollTo({ top: 0 });
}, [filterKey, scrollElement]);
```

现有实现依赖 `[filter, scrollElement]`，挂载时 `scrollElement` 从 `null` 变为元素也会触发归零，会与恢复竞争；改为按 `filterKey` 变化判定后，挂载不再归零。

### 3.5 透传（`components/knowledge/KnowledgeGrid.tsx`）

`KnowledgeGridProps` 增加同名的两个可选属性，`KnowledgeGridVirtual` 原样传给 `useVirtualGrid`。组件本身不引入新逻辑。

## 4. 恢复时序

1. 路由挂载，`useKnowledgeViewState` 冻结 `initialFilter` / `initialRestoreIndex`；
2. 筛选初值生效，`queryKey` 命中缓存（≤5 分钟）→ `items` 首帧即有值；
3. `scrollElement` 就绪 → `useVirtualGrid` 执行一次性恢复：`0 < saved < count` 时 `scrollToIndex(saved, 'start')`；
4. 之后正常滚动，`onChange` 持续把首可见项索引写回 store；
5. 离开页面时无需额外动作——store 里已是最新位置。

## 5. 边界与降级

- **缓存已回收 / 数据删减**：`saved >= count` → 不滚动，回顶部，仅 1 次首页请求。
- **StrictMode 双跑**：恢复由 `restoredRef` 守卫，effect 重复执行不会二次滚动。
- **页内改筛选**：回顶部；随后 `onChange` 会把新位置（起点 0）写回 store，因此「改完筛选立刻离开再返回」落点是顶部。
- **删改数据后的索引错位**：索引指向条目序号，乐观更新会同步增删缓存条目；位置可能产生 1~2 项偏差，可接受。
- **不做**：跨 F5、追补分页、按筛选组合分别记忆位置。

## 6. 测试

- `use-virtual-grid.test.ts`
  - `onFirstVisibleItemChange` 随 `onChange` 上报首可见项索引；
  - 虚拟项含 `overscan` 时上报首个 `start >= scrollOffset` 的项（不报 overscan 首项）；无可见项时不调用；
  - 回调经 ref 转发：重渲染后用旧 options 的 `onChange` 也取到最新回调；
  - `initialRestoreIndex` 满足 `0 < index < count` 时调用一次 `scrollToIndex`；
  - `index >= count` 或 `index === 0` 时不调用。
- `use-knowledge-view-state.test.ts`（新增）
  - 写入后再次挂载能读回（模块级 store 的返回恢复语义）；
  - 挂载期间写入不改变已冻结的 `initialRestoreIndex`。
- `use-knowledge.test.tsx`
  - 卸载后在 `gcTime` 内重新挂载**不再发起请求**（与上一轮「不重放」方向一致的回归保护）。
- `KnowledgeGrid.test.tsx`
  - 通过 mock `@/hooks/use-virtual-grid` 断言两个新属性被透传（`initialRestoreIndex` / `onFirstVisibleItemChange`）。

## 7. 风险与取舍

- **`scrollToIndex` 基于估算高度**：动态测量完成后落点可能略有偏差。实测若偏差明显，再补一次测量后的二次校正；本轮先不加，避免过度设计。
- **锚点偏移（已修正）**：首版实现上报 `getVirtualItems()[0]?.index ?? 0`，而默认 range extractor 会把 `overscan`（本 hook 为 3）项也算入虚拟项，上报值比真实首可见项小 3 项，往返「离开→返回」会累积向上漂移——正是本功能要保证的行为。现改为上报首个 `start >= scrollOffset` 的可见项索引（无可见项则不上报），并已加回归测试覆盖。
- **恢复时的首帧跳动（已修正）**：恢复副作用改用 `useLayoutEffect`，在绘制前完成跳转，避免先绘制顶部再跳转。
- **5 分钟内的数据非最新**：返回看到的可能是最长 5 分钟前的数据。增删改点赞已由乐观更新就地修正缓存，其余以「刷新/离开超时后再进」兜底。
- **`refetchOnMount: false` 是全局性的**：该 hook 返回的列表不再在挂载时自动校验；显式 `refetch()`（错误态重试）行为不变。
- **筛选不体现在 URL**：无法分享筛选视图、浏览器前进后退不切换筛选；换取实现简单与「F5 不恢复」的一致性。
