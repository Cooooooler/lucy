# 后端 AI 对话模块设计

日期：2026-08-09 分支：feature/auth-login

## 背景与目标

后端新增 AI 对话能力，供前端聊天界面消费。模型走本地 Ollama（baseUrl 先用 `http://localhost:11434`），LLM 调用统一经 LangChain（`@langchain/ollama` 的 `ChatOllama`）。目标：

1. 多轮对话 + 持久化：conversation / message 实体落库，会话可查询历史。
2. 流式响应：SSE 逐 token 推送，贴近真实聊天体验。
3. 归属登录用户：conversation 挂 `user_id`，鉴权沿用全局 JWT 守卫 + `@CurrentUser()`。
4. 模型可切换：会话级默认模型 + 请求级覆盖。
5. 上下文按 token 预算截断（可配置），保证长对话不撑爆上下文。
6. 完整 CRUD + 首条消息异步生成标题。

## 决策记录

- **对话形态**：多轮 + 持久化（新建 conversation/message 实体，按会话历史带上下文）。
- **响应方式**：SSE 流式（`POST` + `@Sse`，前端用 fetch ReadableStream 消费）。
- **归属**：conversation 挂 `user_id`，接口校验归属，仅本人可见/操作。
- **模型指定**：创建会话时可选 `model` 落库为会话默认；发消息时可选 `model` 覆盖本次请求；都为空则用 env 默认。
- **上下文策略**：token 预算截断。历史预算 = `AI_CONTEXT_TOKEN_LIMIT × AI_CONTEXT_RESERVE_RATIO`，从最近消息往前累加，超预算即停；保留系统提示。
- **持久化时序**：正常路径流结束后写完整助手消息（`complete`）；异常/断线在 catch 里把已生成半截落库（`aborted`/`failed`）。
- **标题生成**：首条用户消息落库后异步调一次 Ollama 生成 ≤20 字标题并更新；**失败不兜底截断**，标题保持为空，用户可 `PATCH` 手动改名。
- **依赖**：`@langchain/ollama` + `@langchain/core`，不引 `langchain` 元包。`OllamaFactory` 按 model 缓存 `ChatOllama` 实例。
- **token 计数**：调 Ollama `/api/tokenize`（模型精确分词，结果缓存），出错时按字符数估算兜底。

## 新增依赖

- `@langchain/ollama`（`ChatOllama`，SSE 流式 + invoke）
- `@langchain/core`（消息/类型基座）

## Section 1：模块结构

```
apps/backend/src/ai/
  ai.module.ts                    — 装配，imports ConfigModule + TypeOrmModule
  ai.controller.ts                — 7 个 REST 接口（1 个 SSE）
  ai.service.ts                   — 编排：CRUD + 发消息 + 标题生成
  ollama.factory.ts               — 按 model 生产/缓存 ChatOllama 实例
  context.service.ts              — token 预算截断
  tokenizer.service.ts            — Ollama /api/tokenize 计数（缓存 + 估算兜底）
  entities/conversation.entity.ts
  entities/message.entity.ts
  dto/create-conversation.dto.ts
  dto/send-message.dto.ts
  dto/conversation-response.dto.ts
  dto/message-response.dto.ts
```

`OllamaFactory` 维护 `Map<model, ChatOllama>`，baseUrl/温度等参数从 env 读取，会话&请求级换模型无需重建开销。

## Section 2：数据模型（TypeORM，`synchronize:false`，走迁移）

**`ai_conversations`**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK（默认 gen_random_uuid） |  |
| userId | bigint，FK→users.id（users.id 为 bigint） | 归属 |
| title | varchar(50) 可空 | 首条消息后异步生成，可 `PATCH` 改 |
| model | varchar 可空 | 会话默认模型，空=env 默认 |
| createdAt / updatedAt | timestamptz | updatedAt 随内容变更刷新（列表按此排序） |

**`ai_messages`**

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK |  |
| conversationId | uuid，FK→ai_conversations.id，ON DELETE CASCADE |  |
| role | enum：user/assistant/system |  |
| content | text |  |
| status | enum：complete/aborted/failed，可空 | 仅 assistant 有值；user/system 为 null |
| createdAt | timestamptz | 查询按此正序 |

索引：`ai_messages(conversation_id, created_at)`。

## Section 3：API 面（全局 JWT 守卫 + 归属校验）

| 方法 | 路径 | 请求 | 说明 |
| --- | --- | --- | --- |
| POST | `/ai/conversations` | `{model?}` | 创建会话 |
| GET | `/ai/conversations` | query `page?/pageSize?` | 会话列表（updatedAt desc，分页） |
| GET | `/ai/conversations/:id` |  | 会话详情 + 消息正序 |
| PATCH | `/ai/conversations/:id` | `{title}` | 改名 |
| DELETE | `/ai/conversations/:id` |  | 删除（级联删消息） |
| POST | `/ai/conversations/:id/messages` | `{content, model?}` | SSE 流式回复 |

归属校验：所有 `:id` 操作先查 conversation，`userId !== 当前用户` 则抛 `BusinessException`（403/404）。

## Section 4：核心流程

### 发消息（SSE + 持久化 + 兜底）

1. 校验会话归属 → 若本次带 `model` 覆盖，`OllamaFactory` 取对应实例，否则用会话 model 或 env 默认。
2. 落库用户消息（`role=user`，`status=null`）。
3. 若该会话此前无消息（首条）→ 触发异步标题生成（不阻塞主流程，见下）。
4. `context.service` 截断：取历史（含系统提示）+ 新消息，按 token 预算保留最近内容，构造 `SystemMessage`/`HumanMessage`/`AIMessage` 数组。
5. `chatModel.stream(messages)` 逐 token 输出 → SSE `message` 事件转发 `{type:'delta', content}`。
6. 流正常结束 → 聚合完整内容落库助手消息（`status=complete`），SSE 发 `{type:'done'}`。
7. 异常/客户端断开 → catch 里把已生成半截落库（`status=aborted`/`failed`），SSE 发 `{type:'error', message}`。

### 标题异步生成

- 截断标题**不做**：首条消息后直接后台 `invoke()` Ollama（prompt 见 `AI_TITLE_PROMPT`），成功后 `UPDATE ai_conversations SET title=...`。
- 失败静默：title 保持 null，不阻塞主流程，用户可手动 `PATCH` 改名。
- 并发安全：`title IS NULL` 条件更新，避免多次触发互相覆盖。

### 上下文截断（context.service）

- 预算：`historyBudget = AI_CONTEXT_TOKEN_LIMIT × AI_CONTEXT_RESERVE_RATIO`（默认 4096×0.7）。
- 从最近的 assistant/user 消息开始往前累加 token 数，超预算即停，保留系统提示与新消息。
- token 数由 `tokenizer.service` 给出：优先 Ollama `/api/tokenize`（按模型分词，`Map<model, number>` 缓存），失败回退 `Math.ceil(字符数 / 2)` 估算。

## Section 5：配置项（`.env`，参考 `.env.example`）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_MODEL` | `qwen2.5:7b` | 默认模型 |
| `AI_CONTEXT_TOKEN_LIMIT` | `4096` | 上下文 token 总预算 |
| `AI_CONTEXT_RESERVE_RATIO` | `0.7` | 历史占用预算比例 |
| `AI_SYSTEM_PROMPT` | 空 | 系统提示，空则不注入 |
| `AI_TITLE_PROMPT` | `为这段对话生成一个不超过20字的简短标题，只输出标题本身：` | 标题生成 prompt，前接首条用户消息 |

## Section 6：测试

- 单测（`*.spec.ts`，纳入现有覆盖率门槛）：
  - `context.service`：预算截断边界、空历史、超预算、保留最近内容。
  - `tokenizer.service`：tokenize 成功路径 + 失败估算兜底 + 缓存命中。
  - `ai.service`：mock `ChatOllama` 的 stream/invoke——正常流完整落库、中途 throw 落半截 `aborted`、首条消息触发标题生成、归属校验拒绝。
  - DTO 校验：`send-message.content` 必填、`model` 可选。
- e2e（可选，后续补）：SSE 流基本形状。

## 风险与取舍

- `@langchain/ollama` 的 `ChatOllama` API 以安装后类型签名为准微调（版本 1.3.0）。
- Ollama `/api/tokenize` 依赖本地服务可用，估算兜底保证离线单测不炸。
- 首版不落库 system prompt 会话（system 消息只存在于运行时上下文拼接），避免冗余。
- 标题生成失败不重试，保持简单；未来可加队列重试。
