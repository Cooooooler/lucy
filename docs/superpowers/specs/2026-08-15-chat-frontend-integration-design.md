# 前端聊天页中栏联调设计

日期：2026-08-15 分支：feature/auth-login

## 背景与目标

后端 AI 模块已完整（会话 CRUD + SSE 流式发消息），前端聊天页 `_layout/chat` 仍是占位（mock 会话、mock 气泡、`ThoughtChain`/`Prompts` 装饰）。本设计把聊天页的**中栏消息区**接到真实后端：

1. 通过路由参数 `/chat/:conversationId` 指定会话，中栏展示该会话历史消息。
2. `Sender` 发送消息 → SSE 流式消费 → 助手气泡逐 token 更新。
3. 支持停止生成、错误（超时/忙碌/生成失败/会话不存在）展示。

会话列表/新建/改名/删除（左栏）与右栏 `ThoughtChain` 均不在本次范围，后续再做。

## 决策记录

- **范围**：仅中栏消息区。移除左栏 `ChatConversations`、右栏 `ThoughtChain`、`Prompts` 占位，页面简化为 `Bubble.List` + `Sender`。
- **会话来源**：路由参数 `/chat/:conversationId`。`/chat`（无 id）显示空态占位，不做自动创建。
- **流式架构**：新增专用 hook `useChatStream(conversationId)`，内部复用 `useHookFetch`（取其 `stream`/`cancel`/`loading`），避免给 `streamSendMessageApi` 加 signal 参数。
- **渲染**：助手消息纯文本，不引入 `@ant-design/x-markdown`。
- **停止**：`useHookFetch.cancel()` → 内部 `Request.abort()` → 中断 fetch → 后端 `res.on('close')` 触发模型流 abort。

## API 小重构：`createStreamRequest`

`useHookFetch` 的 `request` 函数须返回 **hook-fetch Request 对象**（内部再调 `.stream()`），而 `streamSendMessageApi` 返回生成器。故拆出一个返回 Request 的导出，`streamSendMessageApi` 保持对外行为不变：

```ts
export function createStreamRequest(conversationId, input) {
  return http.post<AiStreamEvent>(
    `ai/conversations/${conversationId}/messages`,
    input,
    {
      extra: { skipAuthRefresh: true },
    },
  );
}

export function streamSendMessageApi(conversationId, input) {
  return createStreamRequest(conversationId, input).stream();
}
```

既有 `streamSendMessageApi` 的测试（`ai.test.ts`）不受影响。

## 核心 hook：`useChatStream(conversationId)`（`src/hooks/use-chat.ts`）

```
ChatMessage = { key, role: 'user'|'assistant', content, streaming?, error? }
```

内部组合 `useConversation(id)`（TanStack Query 拉历史）+ `useHookFetch({ request: createStreamRequest })`：

- **初始化**：组件按 conversationId `key` 重挂载；历史数据到达后一次性从 `conversation.messages` 初始化（用 `initializedRef` 防止后续 refetch 覆盖流式状态）。assistant 的 `aborted`/`failed` 消息映射为 `error` 气泡。
- **`send(content)`**：`streaming` 时忽略 → 追加 user 消息 + 空 `streaming:true` 的 assistant 消息 → `for await (chunk of stream(id, {content}))`：
  - `delta`：把 `event.data.content` 追加到该 assistant 消息。
  - `error`：置 `streaming:false` + `error: event.data.message`。
  - `done`：置 `streaming:false`。
  - 流异常（AbortError/网络/401）→ catch 置 `streaming:false` + `error:'生成中断'`。
  - finally 复位 `streaming`。
- **`stop()`**：`cancel()`。
- 暴露 `{ messages, streaming, isLoading, error, send, stop }`。

本地消息列表为本次会话事实源；流结束后不主动 refetch（避免闪烁），下次访问 URL 时 `useConversation` 重新拉全量历史。

## 路由与页面

- `src/routes/_layout/chat.tsx` → `/chat` 空态占位（提示通过 `/chat/:id` 访问）。
- `src/routes/_layout/chat.$conversationId.tsx` → 中栏消息区：
  - `const { conversationId } = Route.useParams()`。
  - `roles` 配置组件外定义（assistant 靠左、user 靠右）。
  - 渲染：历史加载中 → loading；`conversationQuery.error`（404）→ 错误态；否则 `Bubble.List`（streaming 消息 `streaming=true`、空内容 `loading=true`、错误消息渲染错误文案）+ `Sender`（`loading={streaming}`、`onSubmit=send`、`onCancel=stop`）。
  - 消息区组件以 `key={conversationId}` 挂载，保证切换会话时状态隔离。

路由文件被覆盖率排除（`src/routes/**`），逻辑薄，业务逻辑全部在 `useChatStream`。

## 错误处理

| 场景 | 表现 |
| --- | --- |
| SSE `error` 事件（忙碌 40903/超时 50002/失败 50001/中止 49901/会话不存在 40401） | 助手气泡显示 `event.data.message`，结束流式 |
| 流异常（AbortError、网络、401） | 助手气泡显示「生成中断」 |
| 会话不存在（GET 详情 404） | 页面错误态 |
| 重复发送（`streaming` 中） | `send` 忽略 |

## 文件结构

| 文件 | 改动 |
| --- | --- |
| `apps/frontend/src/api/ai.ts` | 修改：新增 `createStreamRequest`，`streamSendMessageApi` 复用它 |
| `apps/frontend/src/hooks/use-chat.ts` | 新建：`useChatStream` |
| `apps/frontend/src/hooks/use-chat.test.tsx` | 新建：hook 单测 |
| `apps/frontend/src/api/ai.test.ts` | 修改：补 `createStreamRequest` 用例（可选） |
| `apps/frontend/src/routes/_layout/chat.tsx` | 修改：改为 `/chat` 空态 |
| `apps/frontend/src/routes/_layout/chat.$conversationId.tsx` | 新建：中栏消息区 |

## 测试

- `use-chat.test.tsx`（TDD）：
  - mock `./use-ai` 的 `useConversation`（可控历史/error）、mock `@/api/ai` 的 `createStreamRequest`（返回 `{ stream: () => 可迭代事件流, abort: vi.fn() }`，`useHookFetch` 为真实实现）。
  - 用例：历史初始化映射；`send` 追加 user+assistant 并消费 delta 累积内容；`error` 事件置 error 并结束；`done` 结束 streaming；流抛错置「生成中断」；`stop` 调用 `cancel`；`streaming` 中 `send` 忽略。
- 路由为薄 UI，覆盖排除，不单独写测试。

## 风险与取舍

- **`useHookFetch.cancel()` 语义**：`cancel()` 置 `loading=false` 并 `Request.abort()`；流生成器读到 AbortError，由 `send` 的 catch 收尾。已验证 `abort()` 走内部 `AbortController`。
- **历史初始化与流式防覆盖**：用 `initializedRef` 保证历史只在首次数据到达时注入，避免 TanStack Query 后续 refetch（如窗口聚焦）覆盖流式消息。
- **不自动创建会话**：`/chat` 为死胡同空态，需手输 URL；待左栏会话面板接入后解决。
- **401 流式**：`skipAuthRefresh` 下 401 直接失败，气泡显示「生成中断」；全局会话过期流程不受影响，后续如需可加单飞刷新重建流。
