# 知识库卡片减重与共享表单抽屉设计

- 日期：2026-09-12
- 状态：待实施
- 分支：feature/knowledge
- 涉及：`apps/frontend/src/components/knowledge/**`、`apps/frontend/src/routes/_layout/knowledge.tsx`

## 1. 背景与目标

返回知识库时（缓存保留，无加载骨架）会一次性挂载约 34 张卡片。LoAF 实测：单次返回阻塞 **600-900ms**，且是**两趟**整窗渲染（挂载 + 测量后重渲染），forcedLayout 仅 38ms —— 纯 JS 渲染成本。每张卡片当前各自持有一套编辑抽屉与表单：

- `KnowledgeCard` 每张各自 `Form.useForm()` + `<Drawer>` + `<Form>`/`<Form.Item>`，并调用 `useUpdateKnowledgeBase`；
- `KnowledgeToolbar` 另有一套创建抽屉。

目标：

1. 创建/编辑**共用同一个抽屉**（单例），卡片与工具栏只表达意图；
2. 卡片标题**单行显示、超出省略**，使**卡片等高**；
3. 为「用固定高度取代动态测量、把两趟渲染减为一趟」创造条件（见 §2.4，按实测决定）。

非目标：本次不改动 `Paragraph` 描述区的省略实现（其高度已由 `h-11` 固定）、不改动点赞/删除等既有交互。

## 2. 决策记录

### 2.1 抽屉状态上提到路由，卡片/工具栏只发意图

`KnowledgeFormDrawer` 作为单例由路由渲染；路由持有 `{ mode: 'create' } | { mode: 'edit', kb } | null`；`KnowledgeToolbar` 新增 `onCreate: () => void`，`KnowledgeCard` 新增 `onEdit: (kb) => void`（经 `KnowledgeGrid` 透传）。

理由：每卡一套 `Form.useForm()` + `<Drawer>` + `<Form>` + 一个 `useMutation` 实例，34 张卡片即 34 套；单例可一次性去掉这些开销。把状态放路由而非新建 store，是因为本页已有「路由持有筛选、向下透传」的既有风格，且不需要跨页共享。

### 2.2 标题单行省略用 CSS + 原生 `title`，不用 antd 组件

标题渲染为 `<span className="block truncate" title={kb.name}>`：`truncate`（`overflow:hidden` + `text-overflow:ellipsis` + `white-space:nowrap`）保证单行省略；`title` 属性提供零成本的全名查看，避免再挂一个 antd `Tooltip`（每卡一个 Tooltip 正是要减的重量）。

### 2.3 卡片等高的构成

标题固定 1 行；描述固定 `h-11`（既有）；卡片头部与操作区高度固定。因此**卡片高度与内容无关**，只取决于容器宽度下的一行高度。

### 2.4 是否改用固定 `estimateSize`（去掉 `measureElement`）——按实测决定，本次先不做

`measureElement` 是第二趟整窗渲染的来源：测量结果回填 → 虚拟化器通知 → 再渲染一次。卡片等高后，理论上可用固定 `estimateSize` 完全去掉这一趟（约省一半阻塞）。但 `estimateSize` 必须**精确等于**真实行高（卡片高 + `GRID_GAP`），拍脑袋写常量会让锚点与滚动位置整体偏移。

因此：本次先落地 2.1-2.3，然后在真实浏览器**实测**卡片高度，再据实测值决定是否切换（切换时一并更新 `grid-layout.ts` 的 `CARD_ESTIMATED_HEIGHT` 与 `use-virtual-grid.ts` 的 `measureElement`，并补/改对应测试）。

## 3. 实现

- 新增 `components/knowledge/KnowledgeFormDrawer.tsx`：`{ open, mode, kb, onClose }`；内部 `Form.useForm()` + `App.useApp()`；按 `mode` 调用 `useCreateKnowledgeBase` / `useUpdateKnowledgeBase`；`destroyOnHidden` + `preserve={false}`；成功提示 + `onClose()`；失败按既有约定提示（`ApiError` → `e.message`，否则通用文案）。
- `KnowledgeToolbar.tsx`：删除抽屉/表单/创建 mutation，新增 `onCreate`。
- `KnowledgeCard.tsx`：删除抽屉/表单/更新 mutation，新增 `onEdit`，标题改单行省略。
- `KnowledgeGrid.tsx`：新增 `onEdit` 并透传到卡片。
- `routes/_layout/knowledge.tsx`：持有抽屉状态、渲染 `KnowledgeFormDrawer`、向下传 `onCreate` / `onEdit`。

## 4. 测试

- 新增 `KnowledgeFormDrawer.test.tsx`：创建态提交（载荷正确 + 成功提示 + `onClose`）、编辑态预填并提交更新、必填校验、接口失败提示。
- `KnowledgeToolbar.test.tsx`：移除抽屉相关用例，新增「点击新增触发 `onCreate`」。
- `KnowledgeCard.test.tsx`：移除编辑抽屉相关用例，新增「点击编辑以该卡片触发 `onEdit`」；保留点赞/可见性/删除用例。
- `KnowledgeGrid.test.tsx`：补 `onEdit` 透传断言。
- `routes/_layout/knowledge.test.tsx`：按新 props 调整（工具栏 `onCreate`、网格 `onEdit`）。

## 5. 风险与取舍

- **测试迁移量较大**：抽屉相关用例要从工具栏/卡片测试迁到新组件测试，需保证覆盖不降级（提交载荷、校验、失败提示三条都要有归属）。
- **卡片等高依赖「标题 1 行 + 描述固定高」这一约束**：将来若有人给标题或描述加可变行数，等高假设会被破坏；§2.4 若采用固定高度，虚拟化对高度变化的敏感度会更高，需在代码注释与本文档写明该约束。
- 单例抽屉意味着同一时刻只能编辑一个知识库（原实现也只会打开一个，无行为损失）。

## 6. 实施后的追加决策（性能实测驱动，2026-09-12）

用户要求「不论用什么方法」解决返回卡顿。经 LoAF 逐项实测，最终把卡片本体也换成轻量标记，而不再使用 antd `Card`。

### 6.1 实测数据（dev + StrictMode，同一预热方法，3 次采样取一致值）

| 阶段 | 阻塞 | 说明 |
| --- | --- | --- |
| 改造前 | ~448ms（两帧 282+165） | 每张卡片函数体执行 **3.4 次** |
| `overscan` 3→1 | ~397ms | overscan 单位是**条目**（非行）；3→1 只少挂 4 张卡 |
| 修复「先挂顶部窗口再跳恢复位置」 | ~325ms | 每卡执行降到 **2.0 次**（仅剩 StrictMode 双渲染），帧合并为单帧 |
| 4 个 antd `Button` → 原生 `button` | ~245ms | antd Button 约占 80ms |
| `Card`/`Card.Meta`/`Avatar` → 轻量标记 | ~175ms | antd `Card` 自身占约 140ms |
| 6 个 antd 图标 → 内联 SVG | **~118ms** | ~120 个图标组件实例约占 70ms |

**结论：返回卡顿的主因是「一次挂载约 30 张 antd 卡片 × dev StrictMode 双渲染」的纯渲染成本**，与数据请求（实测 0 请求）、恢复逻辑（A/B 对照几乎相同）、mutation hooks（替换为普通对象后无变化）都无关。

### 6.2 决策：卡片改用轻量标记 + 内联图标

- `KnowledgeCard` 不再使用 antd 的 `Card` / `Card.Meta` / `Avatar` / `Button`，改为 Tailwind 标记；主题仍走 antd 的 CSS 变量（`bg-(--ant-color-bg-container)`、`divide/border-(--ant-color-split)`），与 `KnowledgeToolbar` 的做法一致，深色/浅色主题自动跟随。
- 新增 `knowledge-icons.tsx`：6 个图标的 SVG 路径**逐字取自** `@ant-design/icons-svg` v4.5.0（运行时渲染结果亦已比对），视觉与 antd 图标一致，去掉 `Icon` 组件的 context/包装开销。
- **卡片高度由 CSS 显式固定**：整卡 `h-[210px]`（标题行 46 + 内容 118 + 操作行 46）。这比原先「靠内容自然等高」更稳——高度不再依赖内部内容行数。

### 6.3 必须遵守的约束

- `KnowledgeCard` 的 `h-[210px]` 与 `grid-layout.ts` 的 `CARD_ESTIMATED_HEIGHT = 210` **一一对应**；改动任一必须同步改另一，否则虚拟化行高失真会导致滚动位置整体偏移。
- 卡片内的图标请继续用 `knowledge-icons.tsx`（不要换回 `@ant-design/icons` 组件）——那是本次性能收益的组成部分。

### 6.4 未做/未验证

- **生产构建未实测**：dev 下的数值含 StrictMode 双渲染（约占一半），预期生产环境约为 dev 的一半（~50-60ms）；如需确切数字需解决生产预览的 API 代理/跨域。
- 恢复落点仍有「≤ 1 行（最多 `lanes` 个条目）」的固有残差（见返回恢复设计的 §3.2），本次未改。
