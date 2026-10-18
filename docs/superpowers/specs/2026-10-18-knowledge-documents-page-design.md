# 知识库详情页（文件表格）设计

## 背景

知识库模块目前只有列表页（`/_layout/knowledge`）：卡片网格 + 新建/编辑抽屉 + 点赞/可见性/删除。

后端与前端的数据层其实已经为「知识库内部的文件」铺好了，只是没有 UI 消费：

- 后端 `GET/POST/DELETE /v1/knowledge/:kbId/documents`、`GET /v1/knowledge/:kbId/documents/:id` 已就绪；
- 前端 `api/knowledge.ts` 与 `hooks/use-knowledge.ts` 里 `listDocumentsApi`/`getDocumentApi`/`addDocumentApi`/`deleteDocumentApi` 及对应 hooks 全都在，但**没有任何页面或组件调用**（生产代码里唯一的引用是它们自己的测试）。

同时，卡片目前整卡不可点击，`CardShell` 也没有「打开」这一概念。

## 目标

1. 点击知识库卡片进入该知识库的详情页；
2. 详情页主体是一张**文件表格**（文档列表），页头给出所属知识库信息与「上传文档」入口；
3. 详情页的文档列表改为 **Offset（页码）分页**：表格要页码、总条数与跳页，游标分页表达不了这些。

## 范围

**做**

- 文档列表端点由游标分页改为页码分页（含契约、服务、测试、Swagger 生成与共享类型）；
- 文档契约补上文件元数据（文件名/扩展名/MIME/大小）；
- 卡片打开热区（可点击 + 键盘可达 + 支持中键新标签页）；
- 详情路由与页面：页头、文件表格（文件名/类型/大小/上传时间/操作）、查看解析文本抽屉、删除、上传文档、文件名/内容搜索；
- 上述改动对应的单测（前后端）、e2e、以及钉住契约与文档边界的用例。

**不做**（明确排除，避免范围蔓延）

- 下载原文件：需要新端点（`FileService` 取流、`Content-Disposition`、流式响应与权限校验），不在本次；
- 多文件批量上传 / 拖拽上传队列：单文件逐个上传够用，队列状态管理是另一件事；
- 表格排序、列自定义、导出。

## 决策与理由

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 详情路由落地 | 目录化：`knowledge.tsx`（纯 layout）+ `knowledge/index.tsx`（列表）+ `knowledge/$kbId.tsx`（详情） | 与 `integration` 模块同款；TanStack Router 里 `knowledge.$kbId.tsx` 会**嵌在** `knowledge.tsx` 之下，把列表页当布局会让列表在详情 URL 上也被渲染。目录化后列表与详情是兄弟页，语义正确 |
| 整卡可点 | `CardShell` 新增 `openLink?: ReactNode`，作为**首个子元素**渲染成覆盖热区 | 真锚点：可键盘聚焦、可中键/新标签页打开，无需 `role="button"`（避免交互元素嵌套在按钮里）。角标与操作栏在其后且带定位，绘制顺序天然压住热区，**不需要 `stopPropagation`，也不需要 z-index** |
| Link 由谁渲染 | 路由注入（`renderItem` 里传 `<Link to="/knowledge/$kbId" …>`） | 卡片保持无路由依赖：`KnowledgeCard.test.tsx` 的 17 个裸渲染用例不必套 `RouterProvider`；也延续「卡片只上报意图，路由持有 mutation/导航」的既有分工 |
| 表格实现 | `@ant-design/pro-components` 的 `ProTable`（`search={false} options={false}`） | 与 `users.tsx`（项目里唯一另一处表格）一致；页码 + 总数正好对上 `PageResult`。知识库**卡片**刻意不用 antd `Card` 是虚拟化性能考量，与表格无关 |
| 分页改造方式 | 直接把现有文档端点改成页码分页，不保留游标版本 | 前端尚无消费者，保留两种分页形状等于给自己留一份死代码；知识库**列表**（卡片 + 虚拟网格）仍是游标分页，两者各自匹配交互形态 |
| 文件元数据加在哪 | 列表项与详情契约**都加** | `gen-openapi.spec.ts` 钉着不变量「详情字段 = 列表字段 + content」。只加列表项会让该用例红，且两个契约漂移。上传响应也走详情契约，前端能拿到同样形状 |
| 关联查询 | `innerJoin('d.file','f')` | `file_id` 是 NOT NULL 外键且 `onDelete: CASCADE`，内连接不可能丢行；比 `leftJoin` 更贴合数据事实，也能明确表达「列表一定要文件元数据」 |

## 后端设计

### 契约

- `DocumentListQueryDto`：由 `extends CursorQueryDto` 改为 `extends PageQueryDto`（`page`/`pageSize`），保留 `keyword`（标题/内容模糊匹配，边界 `KNOWLEDGE_KEYWORD_MAX_LENGTH`）。
- `DocumentListResultDto`：`{ list, total, page, pageSize }`，形状与 `UserListResultDto` / 共享 `PageResult<T>` 一致。
- `KnowledgeDocumentListItemDto` 与 `KnowledgeDocumentDetailDto` 各新增：
  - `originalName: string`（原始文件名）、
  - `ext: string`（含点的扩展名，如 `.pdf`）、
  - `mime: string`、`size: number`（字节）。

### 服务实现（`KnowledgeDocumentService.listDocuments`）

1. `resolveReadableKb` 鉴权不变（属主或公开库可读）。
2. `resolvePageNumber(query.page)` / `resolvePageSize(query.pageSize)` 归一化（与 users 列表同一处边界策略）。
3. 查询：`innerJoin('d.file', 'f')` + 列投影（`d.id/knowledgeBaseId/fileId/title/createdAt/updatedAt` 与 `f.originalName/ext/mime/size`）——`content` 依旧不进 SELECT；`keyword` 时追加 `(d.title ILIKE :kw OR d.content ILIKE :kw)`（转义沿用 `escapeLikePattern`）。
4. 排序 `d.created_at DESC, d.id DESC`，`skip((page-1)*pageSize).take(pageSize)`，`getManyAndCount()`。
5. 返回 `{ list: rows.map(toDocumentListItem), total, page, pageSize }`。

**不需要迁移**：`IDX_knowledge_documents_kb_created_id` 已提供 `(knowledge_base_id, created_at DESC, id DESC)` 的有序扫描，OFFSET 分页同样走它。

### 测试影响

- `knowledge-document.service.spec.ts`：游标相关用例（解码行比较、`take(n+1)`、游标编码）改为页码用例（`skip`/`take` 数值、`getManyAndCount` 的 total、归一化越界入参、`innerJoin` + 元数据投影）。
- `knowledge.controller.spec.ts`：`listDocuments` 的 query 透传形状更新。
- `test/knowledge.e2e-spec.ts`：`sweepDocuments` 由游标循环改为页码循环（按 `total`/页大小收敛），并断言列表项带文件元数据。
- `scripts/gen-openapi.spec.ts`：`/knowledge/{kbId}/documents` 从「游标参数」分组移到「页码参数」分组（`page`/`pageSize` 边界）；文档字段集用例补 4 个新字段。

## 前端设计

### 路由结构

```
routes/_layout/knowledge.tsx          # 纯 layout：只渲染 <Outlet/>
routes/_layout/knowledge/index.tsx    # 现有列表页（原 knowledge.tsx 内容）
routes/_layout/knowledge/$kbId.tsx    # 新增：详情页
routes/_layout/knowledge/index.test.tsx  # 现有列表页用例（原 knowledge.test.tsx）
```

`routeTree.gen.ts` 由插件重新生成，不手改。列表页的路由 id 由 `/_layout/knowledge` 变为 `/_layout/knowledge/`；仓库内没有按该字符串取用的代码（视图状态 store 自带 key，不依赖路由 id）。

### 卡片打开热区

`CardShell` 新增可选 `openLink?: ReactNode`：

- 渲染位置：根节点内**第一个**子元素，`absolute inset-0`；角标与操作栏在其后且有定位，绘制在上层，因此它们上面的点击不会被热区吃掉；
- 无 `openLink` 时行为与现在完全一致（模型供应商卡片不受影响）；
- `KnowledgeCard` 新增 `openLink?: ReactNode` 透传给 `CardShell`（卡片仍不 import 路由）。

`knowledge/index.tsx` 的 `renderItem` 注入 `<Link to="/knowledge/$kbId" params={{ kbId: kb.id }} aria-label={'打开知识库：' + kb.name} />`。

### 详情页组成

`knowledge/$kbId.tsx`：

- **页头**（`FullBleedBar`，与列表页工具栏同款）：返回列表的链接（`ArrowLeftOutlined` + 「返回」）、知识库名称与描述（`useKnowledgeBase(kbId)`）、右侧「上传文档」按钮；
- **工具条**：`Input.Search`（占位「按文件名或内容搜索」）；`keyword` 变化时回到第 1 页；
- **表格**（`ProTable`，`rowKey="id"`，`search={false}` `options={false}`）列：
  - 文件名 `originalName`（`ellipsis`）、类型 `ext`、大小 `size`（人类可读，新增 `formatBytes`，与 `cn` 同放 `components/lib/utils.ts` 并扩充现有 `utils.test.ts`）、上传时间 `createdAt`（`dayjs` `YYYY-MM-DD HH:mm`）、操作；
  - 分页 `{ current, pageSize, total, onChange, showSizeChanger: false }`，与 users 页一致；
- **操作列**：「查看」（打开解析文本抽屉）、「删除」（`modal.confirm` 后调接口）；
- **上传**：antd `Upload` 包一个按钮，`beforeUpload` 返回 `false` 阻止自动上传，`accept=".txt,.md,.pdf,.docx"`（与后端 `SUPPORTED_DOCUMENT_EXTS` 对齐），上传中禁用并 `loading`；
- **抽屉**：`useDocument(kbId, docId)` 拉解析全文，标题为文件名，内容 `whitespace-pre-wrap` + 内部滚动，加载态 `Spin`；
- **空态**：`ProTable` 自带空态，文案按「有搜索词 / 无搜索词」区分（对齐卡片网格的 `emptyLabel` 约定）。

### 数据层

- `api/knowledge.ts`：`listDocumentsApi(kbId, query)` 返回 `PageResult<KnowledgeDocumentListItem>`（共享类型，`DocumentListQuery` 由生成的 operations 派生，`pnpm typegen` 后自动变成 `page/pageSize/keyword`）。
- `hooks/use-knowledge.ts`：
  - 删除 `useInfiniteDocumentList`，新增 `useDocumentList(kbId, query)`：`useQuery` + `placeholderData: (prev) => prev` + `staleTime: 30_000` + `refetchOnWindowFocus: false`（与 `useUserList` 一致，翻页不闪骨架）；
  - key 工厂保留 `documentListAll(kbId)` / `documentList(kbId, query)` / `document(kbId, id)`（失效前缀不变）；
  - `useAddDocument` / `useDeleteDocument` 继续失效 `documentListAll(kbId)`，删除额外清 `document(kbId, id)`。
- **页码回退**：删除的是当前页最后一条且页码 > 1 时，先 `setPage(page - 1)` 再删（users 页同款），避免 invalidate 后拉到空页再手动翻页。

### 错误处理

- 页面级失败（知识库详情拉不到 / 越权）：`Result` 展示 `errorMessageOf(error, …)` + 「返回列表」。
- 列表失败：`ProTable` 内就地展示错误与重试，不改整页。
- 上传/删除失败：`message.error(errorMessageOf(e, …))`；成功提示由后端 message 经全局桥弹出（沿用现有约定，路由自己不弹 success）。

### 测试

- `api/knowledge.test.ts`：`listDocumentsApi` 的页码参数与 `PageResult` 解包；上传/删除不变。
- `hooks/use-knowledge.test.tsx`：`useInfiniteDocumentList` 段落替换为 `useDocumentList`（页码请求、`placeholderData` 保留上一页数据、`enabled` 受 `kbId` 控制）；新增/删除的失效断言更新。
- `routes/_layout/knowledge/$kbId.test.tsx`（新）：表格按 hook 返回渲染行与文件元数据、搜索回第 1 页并带 keyword、翻页改变 page 入参、删除确认后才调接口且末页最后一条回退页码、上传走 `useAddDocument`、查看打开抽屉并展示解析文本、知识库详情失败展示错误态。
- `components/knowledge/KnowledgeCard.test.tsx`：补一条「传入 openLink 时渲染出该热区」用例（其余裸渲染用例不受影响）。
- `components/card-list/CardShell.test.tsx`（若不存在则新建最小组件用例）：有 `openLink` 时热区存在且角标/操作栏点击不会误触（角标回调被调用）。
- `formatBytes` 单测（扩充 `components/lib/utils.test.ts`）：0 / B / KB / MB 边界与小数位。
- 路由用例沿用列表页现有手法：真实渲染 `Route.options.component`，`vi.mock` 掉 hooks，`antd App` 包裹。
- 前端 e2e 冒烟（`e2e/smoke.spec.ts`）**逐个路由枚举**，新增动态路由必须同步：`stubApi` 现在把 `/knowledge` 前缀一律当成知识库列表返回，需先分支出 `/documents`（返回单行文档页）与单个知识库详情（返回 KB 对象），再加一条 `{ path: '/knowledge/kb1', title: '知识库 - Lucy', anchor: 'text=上传文档' }`。

## 风险

- **契约破坏性变更**：文档列表响应形状由 `{list, nextCursor}` 变为 `{list, total, page, pageSize}`。仓库内消费者只有前端（且尚未接入 UI），无外部消费方；`DocumentListQuery` 作为共享类型会随 `pnpm typegen` 同步。
- **深翻页语义**：OFFSET 分页在翻页期间若有写入，会出现重复/漏项（keyset 不会）。这是页码分页的固有取舍，也是本次明确的取舍：表格要页码与总数。
- **热区与文本选择**：覆盖热区会阻止卡片内文本选中（描述不可复制）。可接受：卡片描述本就是整块截断展示。

## 验收

1. 点卡片任意非按钮区域进入 `/knowledge/{id}`；中键新标签页也能打开；
2. 详情页表格展示文件名/类型/大小/上传时间，页码与总数正确，可翻页；
3. 上传 txt/md/pdf/docx 成功后列表刷新并出现新行；上传超限/类型不支持时给出后端文案；
4. 「查看」抽屉展示解析全文；「删除」确认后行消失，末页最后一条删除后停在前一页；
5. `pnpm lint` / `pnpm typecheck` / `pnpm test` 全绿；后端 e2e（含真实 Postgres + Redis）通过；前端 e2e 冒烟通过（详情页路由加入冒烟清单）。
