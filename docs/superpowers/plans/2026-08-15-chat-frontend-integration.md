# 前端聊天页中栏联调实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把聊天页中栏消息区接到真实后端——`/chat/:conversationId` 展示历史消息，`Sender` 发送后 SSE 流式逐 token 更新助手气泡，支持停止与错误展示。

**架构：** 路由 `chat.$conversationId.tsx` 持有会话 id；新 hook `useChatStream(conversationId)` 内部组合 `useConversation`（历史）+ `useHookFetch({ request: createStreamRequest })`（流式与取消），维护 `messages` 状态；api 层拆出 `createStreamRequest`（返回 hook-fetch Request）供 `useHookFetch` 驱动，`streamSendMessageApi` 保持返回生成器不变。

**技术栈：** TanStack Router/Query、@ant-design/x（Bubble.List/Sender）、hook-fetch v3（useHookFetch）、Vitest + Testing Library。

**前置条件：** 规格 `docs/superpowers/specs/2026-08-15-chat-frontend-integration-design.md` 已批准。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `apps/frontend/src/api/ai.ts` | 修改：新增 `createStreamRequest`；`streamSendMessageApi` 复用它 |
| `apps/frontend/src/api/ai.test.ts` | 修改：补 `createStreamRequest` 用例 |
| `apps/frontend/src/hooks/use-chat.ts` | 新建：`useChatStream` hook（消息状态 + 流式消费 + 停止/错误） |
| `apps/frontend/src/hooks/use-chat.test.tsx` | 新建：hook 单测（mock useConversation + createStreamRequest） |
| `apps/frontend/src/routes/_layout/chat.tsx` | 修改：改为 `/chat` 空态 |
| `apps/frontend/src/routes/_layout/chat.$conversationId.tsx` | 新建：中栏消息区页面 |
| `apps/frontend/src/page-components/chat/chat-conversations.tsx` | 删除：左栏占位，改造后无引用 |
| `apps/frontend/src/routeTree.gen.ts` | 生成物：新建路由后由 router 插件重生成（勿手改，提交） |

---

### 任务 1：api 层拆分 `createStreamRequest`

**文件：**

- 修改：`apps/frontend/src/api/ai.ts`
- 测试：`apps/frontend/src/api/ai.test.ts`

- [ ] **步骤 1：在 ai.test.ts 增加 `createStreamRequest` 失败用例**

在 `apps/frontend/src/api/ai.test.ts` 的 import 中加入 `createStreamRequest`：

```ts
import {
  createConversationApi,
  createStreamRequest,
  deleteConversationApi,
  getConversationApi,
  listConversationsApi,
  renameConversationApi,
  streamSendMessageApi,
} from './ai';
```

在 `describe('api/ai')` 内、`streamSendMessageApi` 分组之后追加：

```ts
describe('createStreamRequest', () => {
  it('返回带 stream/abort 的请求对象并发出 POST', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(doneFrame + DONE, { status: 200 }),
    );
    const req = createStreamRequest('c1', { content: 'hi' });
    expect(typeof req.stream).toBe('function');
    expect(typeof req.abort).toBe('function');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai/conversations/c1/messages');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ content: 'hi' }));
    const events = await collect(req.stream());
    expect(events[events.length - 1]?.type).toBe('done');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/api/ai.test.ts` 预期：FAIL，`SyntaxError`/Cannot find name `createStreamRequest`（模块未导出）。

- [ ] **步骤 3：实现 `createStreamRequest`**

修改 `apps/frontend/src/api/ai.ts`，把 `streamSendMessageApi` 拆成两段：

```ts
export function createStreamRequest(
  conversationId: string,
  input: SendMessageRequest,
) {
  return http.post<AiStreamEvent>(
    `ai/conversations/${conversationId}/messages`,
    input,
    {
      extra: { skipAuthRefresh: true },
    },
  );
}

export function streamSendMessageApi(
  conversationId: string,
  input: SendMessageRequest,
) {
  return createStreamRequest(conversationId, input).stream();
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/api/ai.test.ts` 预期：PASS（新增用例 + 既有 streamSendMessageApi 全过）。

- [ ] **步骤 5：Commit**

```bash
git add apps/frontend/src/api/ai.ts apps/frontend/src/api/ai.test.ts
git commit -m "refactor(ai): 拆分 createStreamRequest 供 useHookFetch 驱动流式"
```

---

### 任务 2：`useChatStream` hook（TDD）

**文件：**

- 创建：`apps/frontend/src/hooks/use-chat.ts`
- 测试：`apps/frontend/src/hooks/use-chat.test.tsx`

- [ ] **步骤 1：编写失败测试**

创建 `apps/frontend/src/hooks/use-chat.test.tsx`：

```tsx
import type { AiStreamEvent } from '@lucy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatStream } from './use-chat';

const mocks = vi.hoisted(() => ({
  useConversation: vi.fn(),
  createStreamRequest: vi.fn(),
}));

vi.mock('./use-ai', () => ({ useConversation: mocks.useConversation }));
vi.mock('@/api/ai', () => ({ createStreamRequest: mocks.createStreamRequest }));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const requestId = 'r1';
const delta = (content: string): AiStreamEvent => ({
  type: 'delta',
  requestId,
  role: 'assistant',
  data: { content },
});
const done = (): AiStreamEvent => ({
  type: 'done',
  requestId,
  role: 'assistant',
  data: { finish_reason: 'stop' },
});
const errorEvent = (code: number, message: string): AiStreamEvent => ({
  type: 'error',
  requestId,
  data: { code, message },
});

async function* streamOf(events: AiStreamEvent[]) {
  for (const e of events) yield { result: e };
}

function mockConversation(messages: unknown[] = []) {
  mocks.useConversation.mockReturnValue({
    data: { id: 'c1', messages },
    isLoading: false,
    error: null,
  });
}

describe('useChatStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversation([]);
  });

  it('历史消息初始化映射为消息列表', async () => {
    mockConversation([
      { id: 'm1', role: 'user', content: '你好', status: null },
      { id: 'm2', role: 'assistant', content: 'hi', status: 'complete' },
    ]);
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({
      key: 'm1',
      role: 'user',
      content: '你好',
    });
    expect(result.current.messages[1]).toMatchObject({
      key: 'm2',
      role: 'assistant',
      content: 'hi',
    });
  });

  it('send 追加 user/assistant 并消费 delta 累积内容，done 结束', async () => {
    mocks.createStreamRequest.mockReturnValue({
      stream: () => streamOf([delta('你'), delta('好'), done()]),
      abort: vi.fn(),
    });
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(mocks.createStreamRequest).toHaveBeenCalledWith('c1', {
      content: 'hi',
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hi',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: '你好',
      streaming: false,
    });
    expect(result.current.streaming).toBe(false);
  });

  it('error 事件置 error 并结束流式', async () => {
    mocks.createStreamRequest.mockReturnValue({
      stream: () => streamOf([errorEvent(50002, '模型调用超时')]),
      abort: vi.fn(),
    });
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '模型调用超时',
    });
  });

  it('流抛错时置生成中断', async () => {
    async function* broken() {
      throw new Error('boom');
    }
    mocks.createStreamRequest.mockReturnValue({
      stream: () => broken(),
      abort: vi.fn(),
    });
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.messages[1]).toMatchObject({
      streaming: false,
      error: '生成中断',
    });
  });

  it('stop 中止当前流（调用 Request.abort）', async () => {
    const abort = vi.fn();
    async function* pendingGen() {
      yield { result: delta('半截') };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    mocks.createStreamRequest.mockReturnValue({
      stream: () => pendingGen(),
      abort,
    });
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    let promise: Promise<void>;
    act(() => {
      promise = result.current.send('hi');
    });
    await waitFor(() =>
      expect(result.current.messages[1]?.content).toBe('半截'),
    );
    act(() => result.current.stop());
    expect(abort).toHaveBeenCalled();
    await promise;
  });

  it('streaming 中再次 send 被忽略', async () => {
    async function* pendingGen() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield { result: done() };
    }
    mocks.createStreamRequest.mockReturnValue({
      stream: () => pendingGen(),
      abort: vi.fn(),
    });
    const { result } = renderHook(() => useChatStream('c1'), {
      wrapper: createWrapper(),
    });
    let promise: Promise<void>;
    act(() => {
      promise = result.current.send('第一句');
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));
    const length = result.current.messages.length;
    await result.current.send('第二句');
    expect(result.current.messages.length).toBe(length);
    await promise;
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/hooks/use-chat.test.tsx` 预期：FAIL，`Cannot find module './use-chat'`。

- [ ] **步骤 3：实现 `useChatStream`**

创建 `apps/frontend/src/hooks/use-chat.ts`：

```ts
import type { AiStreamEvent } from '@lucy/shared';
import { useHookFetch } from 'hook-fetch/react';
import { useEffect, useRef, useState } from 'react';
import { createStreamRequest } from '@/api/ai';
import { useConversation } from './use-ai';

export interface ChatMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: string;
}

export function useChatStream(conversationId: string) {
  const conversationQuery = useConversation(conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const initializedRef = useRef(false);

  const { stream, cancel } = useHookFetch({
    request: createStreamRequest,
    onError: () => {},
  });

  // 历史只在首次数据到达时注入，避免后续 refetch（如窗口聚焦）覆盖流式状态
  useEffect(() => {
    if (initializedRef.current || !conversationQuery.data) return;
    initializedRef.current = true;
    setMessages(
      (conversationQuery.data.messages ?? []).map((m) => ({
        key: m.id,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
        error:
          m.role === 'assistant' &&
          (m.status === 'failed' || m.status === 'aborted')
            ? m.status === 'failed'
              ? '生成失败'
              : '生成中断'
            : undefined,
      })),
    );
  }, [conversationQuery.data]);

  async function send(content: string) {
    const text = content.trim();
    if (streamingRef.current || !text) return;
    const userKey = `user-${Date.now()}`;
    const assistantKey = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { key: userKey, role: 'user', content: text },
      { key: assistantKey, role: 'assistant', content: '', streaming: true },
    ]);
    streamingRef.current = true;
    setStreaming(true);
    try {
      for await (const chunk of stream(conversationId, { content: text })) {
        const event = chunk.result as AiStreamEvent | null;
        if (!event) continue;
        if (event.type === 'delta') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey
                ? { ...m, content: m.content + event.data.content }
                : m,
            ),
          );
        } else if (event.type === 'error') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey
                ? { ...m, streaming: false, error: event.data.message }
                : m,
            ),
          );
        } else if (event.type === 'done') {
          setMessages((prev) =>
            prev.map((m) =>
              m.key === assistantKey ? { ...m, streaming: false } : m,
            ),
          );
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.key === assistantKey
            ? { ...m, streaming: false, error: '生成中断' }
            : m,
        ),
      );
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  }

  function stop() {
    cancel();
  }

  return {
    messages,
    streaming,
    isLoading: conversationQuery.isLoading,
    error: conversationQuery.error,
    send,
    stop,
  };
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/hooks/use-chat.test.tsx` 预期：PASS（6 个用例全过）。

- [ ] **步骤 5：Commit**

```bash
git add apps/frontend/src/hooks/use-chat.ts apps/frontend/src/hooks/use-chat.test.tsx
git commit -m "feat(chat): 新增 useChatStream hook（历史合并 + SSE 流式消费 + 停止/错误）"
```

---

### 任务 3：路由改造（`/chat` 空态 + `/chat/:id` 中栏消息区）

**文件：**

- 修改：`apps/frontend/src/routes/_layout/chat.tsx`
- 创建：`apps/frontend/src/routes/_layout/chat.$conversationId.tsx`
- 删除：`apps/frontend/src/page-components/chat/chat-conversations.tsx`
- 生成物：`apps/frontend/src/routeTree.gen.ts`（router 插件重生成，提交）

- [ ] **步骤 1：把 `chat.tsx` 改为 `/chat` 空态**

用以下内容整体替换 `apps/frontend/src/routes/_layout/chat.tsx`：

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { Empty } from 'antd';

export const Route = createFileRoute('/_layout/chat')({
  component: ChatEmptyPage,
});

function ChatEmptyPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty description="暂无会话，请通过 /chat/:conversationId 访问" />
    </div>
  );
}
```

- [ ] **步骤 2：创建 `chat.$conversationId.tsx` 中栏消息区**

创建 `apps/frontend/src/routes/_layout/chat.$conversationId.tsx`：

```tsx
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { Bubble, Sender } from '@ant-design/x';
import { createFileRoute } from '@tanstack/react-router';
import { Avatar, Flex, Result, Spin } from 'antd';
import { useState } from 'react';
import { useChatStream } from '@/hooks/use-chat';

export const Route = createFileRoute('/_layout/chat/$conversationId')({
  component: ChatPage,
});

// 组件外定义，保持引用稳定（避免重置打字动画）
const roles = {
  assistant: {
    placement: 'start' as const,
    avatar: <Avatar icon={<RobotOutlined />} />,
  },
  user: {
    placement: 'end' as const,
    avatar: <Avatar icon={<UserOutlined />} />,
  },
};

function ChatPage() {
  const { conversationId } = Route.useParams();
  return (
    <ChatMessagesArea key={conversationId} conversationId={conversationId} />
  );
}

function ChatMessagesArea({ conversationId }: { conversationId: string }) {
  const { messages, streaming, isLoading, error, send, stop } =
    useChatStream(conversationId);
  const [value, setValue] = useState('');

  if (isLoading) {
    return (
      <Flex className="h-full" align="center" justify="center">
        <Spin />
      </Flex>
    );
  }
  if (error) {
    return (
      <Result status="warning" title="会话不存在" subTitle="请检查会话 ID" />
    );
  }

  const items = messages.map((m) => ({
    key: m.key,
    role: m.role,
    content: m.error ?? m.content,
    loading: Boolean(m.streaming && !m.content),
    streaming: Boolean(m.streaming),
  }));

  return (
    <Flex vertical className="h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <Bubble.List items={items} roles={roles} autoScroll />
      </div>
      <div className="px-4 pb-4">
        <Sender
          value={value}
          onChange={setValue}
          onSubmit={(text) => {
            setValue('');
            send(text);
          }}
          loading={streaming}
          onCancel={stop}
          placeholder="输入消息，Enter 发送"
        />
      </div>
    </Flex>
  );
}
```

- [ ] **步骤 3：删除左栏占位组件**

删除 `apps/frontend/src/page-components/chat/chat-conversations.tsx`（改造后已无引用）。

- [ ] **步骤 4：重生成 routeTree.gen.ts 并构建**

运行：`pnpm --filter @lucy/frontend exec vite build` 预期：router 插件重生成 `routeTree.gen.ts`（新增 `/chat/$conversationId` 路由），构建成功。

- [ ] **步骤 5：typecheck + 全量前端测试**

运行：`pnpm --filter @lucy/frontend typecheck` 预期：PASS。

运行：`pnpm --filter @lucy/frontend test` 预期：全绿（含新 `use-chat.test.tsx`）。

- [ ] **步骤 6：Commit**

```bash
git add apps/frontend/src/routes/_layout/chat.tsx apps/frontend/src/routes/_layout/chat.\$conversationId.tsx apps/frontend/src/page-components/chat/chat-conversations.tsx apps/frontend/src/routeTree.gen.ts
git commit -m "feat(chat): 路由支持 /chat/:id 中栏消息区，/chat 空态"
```

---

### 任务 4：收尾验证

**文件：** 无新增

- [ ] **步骤 1：全量 typecheck + test**

运行：`pnpm typecheck && pnpm test` 预期：全绿。

- [ ] **步骤 2：浏览器冒烟（需后端 + DB + Ollama 在线）**

启动：`pnpm dev`

- 登录 → 手动导航到 `/chat/<已存在会话 id>`（如无会话，可用 curl 先创建）： `curl -X POST http://localhost:3000/api/ai/conversations -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{}'`
- 验证：历史消息渲染、发送后助手气泡逐 token 更新、`done` 后停止、生成中 Sender 显示停止按钮、断开会话 id 显示「会话不存在」、`/chat` 显示空态。

若后端不可用，明确说明 UI 未经浏览器验证，仅通过 typecheck/单测。

---

## 风险与取舍

- **`routeTree.gen.ts` 重生成**：`vite build` 触发 router 插件重生成；`tsc -b` 单独跑会用到陈旧路由树，故先 `vite build` 再 typecheck。
- **页面高度**：消息区用 `h-full` 撑满，具体渲染高度依赖 `PageContainer`，若浏览器冒烟发现未撑满再调样式。
- **本地消息为事实源**：流结束后不 refetch，避免覆盖流式状态；下次访问 URL 由 `useConversation` 重拉全量历史。
- **`/chat` 空态**：无创建会话入口，属既定取舍（左栏面板后续接入）。
