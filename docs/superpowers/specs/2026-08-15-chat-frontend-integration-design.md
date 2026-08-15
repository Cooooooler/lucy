# 前端聊天页中栏联调设计

日期：2026-08-15 分支：feature/auth-login

## 背景与目标

后端 AI 模块已完整（会话 CRUD + SSE 流式发消息），前端聊天页 `_layout/chat` 需接到真实后端。本设计实现聊天页**中栏消息区**的联调：

1. `/chat` 直接是可输入的消息区；无会话时**首条消息无感创建**会话并落到 `/chat?id=<conversationId>`。
2. 有会话 id（`/chat?id=xxx`）时展示该会话历史消息，`Sender` 发送后 SSE 流式逐 token 更新助手气泡。
3. 支持停止生成、错误（超时/忙碌/生成失败/会话不存在）展示。

会话列表/新建/改名/删除（左栏）与右栏 `ThoughtChain` 均不在本次范围，后续再做。

## 决策记录

- **范围**：仅中栏消息区。移除左栏 `ChatConversations`、右栏 `ThoughtChain`、`Prompts` 占位，页面简化为 `Bubble.List` + `Sender`。
- **会话来源**：路由**查询参数** `/chat?id=<conversationId>`（`validateSearch` 定义可选 `id`）。选择 query 而非 path 参数的原因：`/chat` 与 `/chat?id=xxx` 是**同一路由**，改 search 不重挂载组件，首条消息的无感创建无需跨路由传递（无 pending 转移、无 StrictMode 双发送问题）。
- **无感创建**：无 `id` 时消息区直接可用；首条消息提交时 `createConversationApi({})` 拿新 id → `navigate({ to: '/chat', search: { id }, replace: true })` → 组件在 `id` 从无到有的 effect 里发送暂存的首条消息（恰好走 `sentRef` 守卫，历史晚到不覆盖流式）。
- **流式架构**：`useChatStream(conversationId?: string)`，内部复用 `useHookFetch`（`stream`/`cancel`/`loading`），避免给 `streamSendMessageApi` 加 signal 参数。
- **渲染**：助手消息纯文本，不引入 `@ant-design/x-markdown`。
- **停止**：`useHookFetch.cancel()` → `Request.abort()` → 中断 fetch → 后端 `res.on('close')` 触发模型流 abort。

## API 小重构：`createStreamRequest`

`useHookFetch` 的 `request` 函数须返回 **hook-fetch Request 对象**（内部再调 `.stream()`），而 `streamSendMessageApi` 返回生成器。故拆出一个返回 Request 的导出，`streamSendMessageApi` 保持对外行为不变：

```ts
export function createStreamRequest(conversationId, input) {
  return http.post<AiStreamEvent>(
    `ai/conversations/${conversationId}/messages`,
    input,
    { extra: { skipAuthRefresh: true } },
  );
}

export function streamSendMessageApi(conversationId, input) {
  return createStreamRequest(conversationId, input).stream();
}
```

既有 `streamSendMessageApi` 的测试（`ai.test.ts`）不受影响。

## 核心 hook：`useChatStream(conversationId?: string)`（`src/hooks/use-chat.ts`）

```
ChatMessage = { key, role: 'user'|'assistant', content, streaming?, error? }
```

内部组合 `useConversation(id)`（TanStack Query 拉历史）+ `useHookFetch({ request: createStreamRequest })`：

- **无 id**：`useConversation(undefined)` 禁用，无历史、messages 空；`send` 因 `!conversationId` 空操作。
- **id 变化重置**：query 参数变化不重挂载，故 hook 用 `currentIdRef` 追踪；id 变化时重置 messages/`initializedRef`/`sentRef`/streaming，重新加载新会话历史。
- **初始化**：历史只在首次数据到达时注入（`initializedRef` + `sentRef` 防覆盖：一旦已 send 或已初始化，不再注入，避免流式消息被 refetch/晚到历史覆盖）。assistant 的 `aborted`/`failed` 历史消息映射为 `error` 气泡。
- **`send(content)`**：`!conversationId` 或 `streaming` 中或空文本 → 忽略 → 追加 user 消息 + 空 `streaming:true` 的 assistant 消息 → `for await (chunk of stream(id, {content}))`：`delta` 追加、`error` 置 error+结束、`done` 结束、异常 catch 置「生成中断」；finally 复位 `streaming` 并清消息级 streaming。
- **`stop()`**：`cancel()`。
- **卸载**：`useEffect(() => () => cancelRef.current(), [])`，切换会话/离开时中止在途流。
- 暴露 `{ messages, streaming, isLoading, error, send, stop }`。

本地消息列表为本次会话事实源；流结束后不主动 refetch（避免闪烁），下次访问 URL 时 `useConversation` 重新拉全量历史。

## 路由与页面

- `src/routes/_layout/chat.tsx` → 唯一聊天页（`createFileRoute('/_layout/chat')`）：
  - `validateSearch` 定义可选 `id`（`string | undefined`）。
  - `const { id } = Route.useSearch()` → `useChatStream(id)`。
  - 无 id：消息区直接可用，Sender 可输入；提交时 `createConversationApi({})` → `navigate({ to: '/chat', search: { id }, replace: true })`，并在 `id` 变化 effect 里 `send` 暂存的首条消息。
  - `roles` 配置组件外定义（assistant 靠左、user 靠右）。
  - 渲染：历史加载中 → loading；`conversationQuery.error`（404）→ 错误态（区分「会话不存在/加载失败」）；否则 `Bubble.List`（streaming 消息 `streaming=true`、空内容 `loading=true`、错误消息渲染错误文案）+ `Sender`（`loading={streaming || creating}`、`onSubmit=handleSubmit`、`onCancel=stop`）。
- 删除 `chat.index.tsx` 与 `chat.$conversationId.tsx`（path 参数方案遗留）。

路由文件被覆盖率排除（`src/routes/**`），逻辑薄，业务逻辑全部在 `useChatStream`。

## 错误处理

| 场景 | 表现 |
| --- | --- |
| SSE `error` 事件（忙碌 40903/超时 50002/失败 50001/中止 49901/会话不存在 40401） | 助手气泡显示 `event.data.message`，结束流式 |
| 流异常（AbortError、网络、401） | 助手气泡显示「生成中断」 |
| 会话不存在（GET 详情 404） | 页面错误态「会话不存在」；其他错误「加载失败」 |
| 重复发送（`streaming` 中） | `send` 忽略 |
| 无会话 id 首条消息 | 无感创建会话并跳转 `/chat?id=`，随后发送首条消息 |

## 文件结构

| 文件 | 改动 |
| --- | --- |
| `apps/frontend/src/api/ai.ts` | 修改：新增 `createStreamRequest`，`streamSendMessageApi` 复用它 |
| `apps/frontend/src/hooks/use-chat.ts` | 新建：`useChatStream`（接受 `string \| undefined`，id 变化重置） |
| `apps/frontend/src/hooks/use-chat.test.tsx` | 新建：hook 单测 |
| `apps/frontend/src/api/ai.test.ts` | 修改：补 `createStreamRequest` 用例 |
| `apps/frontend/src/routes/_layout/chat.tsx` | 新建：聊天页（validateSearch + 无感创建） |
| `apps/frontend/src/routes/_layout/chat.index.tsx` | 删除（path 参数方案遗留） |
| `apps/frontend/src/routes/_layout/chat.$conversationId.tsx` | 删除（path 参数方案遗留） |

## 测试

- `use-chat.test.tsx`（TDD）：
  - mock `./use-ai` 的 `useConversation`（可控历史/error）、mock `@/api/ai` 的 `createStreamRequest`（返回带 `stream`/`abort`/`finally`/`catch` 的 request 对象，`useHookFetch` 为真实实现）。
  - 用例：历史初始化映射；`send` 追加 user+assistant 并消费 delta；`error` 事件置 error；`done` 结束；流抛错置「生成中断」；`stop` 中止；`streaming` 中忽略；send 后历史到达不覆盖流式（sentRef 守卫）；无 id 时 `send` 空操作；id 变化重置并重新注入历史。
- 路由为薄 UI，覆盖排除，不单独写测试（无感创建流程依赖浏览器冒烟验证）。

## 风险与取舍

- **`useHookFetch.cancel()` 语义**：`cancel()` 置 `loading=false` 并 `Request.abort()`；流生成器读到 AbortError，由 `send` 的 catch 收尾。已验证 `abort()` 走内部 `AbortController`。
- **query 参数切换会话**：`/chat?id=a` → `/chat?id=b` 不重挂载，依赖 `useChatStream` 的 id 变化重置逻辑重新加载历史（已实现）。
- **无感创建**：首条消息瞬间有极短创建 loading（`creating` 禁用 Sender）；创建失败走 `finally` 复位。
- **401 流式**：`skipAuthRefresh` 下 401 直接失败，气泡显示「生成中断」；全局会话过期流程不受影响。
