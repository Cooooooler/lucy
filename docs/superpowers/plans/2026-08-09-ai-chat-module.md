# 后端 AI 对话模块实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 后端新增 AI 对话模块——多轮对话持久化、SSE 流式回复（Ollama + LangChain）、token 预算上下文截断、会话 CRUD 与首条消息异步标题生成。

**架构：** NestJS 模块 `src/ai/`，`AiController`（6 REST + 1 SSE）+ `AiService`（编排与持久化）+ `OllamaFactory`（按 model 缓存 `ChatOllama`）+ `TokenizerService`（`/api/tokenize` + 估算兜底）+ `ContextService`（token 预算截断）。实体 `ai_conversations`/`ai_messages` 走迁移。全局 `ApiResponseInterceptor` 对 SSE 路由放行。

**技术栈：** `@langchain/ollama`（`ChatOllama`）、`@langchain/core/messages`、NestJS 11、TypeORM、PostgreSQL、Vitest 4、Ollama 本地服务（`http://localhost:11434`）。

**前置条件：** 本地 Postgres 已启动（`pnpm --filter @lucy/backend db:migrate` 依赖 DB），Ollama 已安装并 `ollama pull qwen2.5:7b`（运行时需要，单测 mock 掉）。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/ai/ai.module.ts` | 装配，imports TypeOrmModule.forFeature([Conversation, Message]) |
| `src/ai/ai.controller.ts` | 6 REST + 1 SSE（POST+@Sse）端点，透传 userId 给 service |
| `src/ai/ai.service.ts` | CRUD + sendMessage（SSE Observable）+ 标题生成 |
| `src/ai/ollama.factory.ts` | 按 model 生产/缓存 ChatOllama 实例 |
| `src/ai/tokenizer.service.ts` | Ollama `/api/tokenize` 计数（缓存 + 估算兜底） |
| `src/ai/context.service.ts` | token 预算截断，构造 langchain 消息数组 |
| `src/ai/entities/conversation.entity.ts` | ai_conversations 实体（含 Swagger 注解） |
| `src/ai/entities/message.entity.ts` | ai_messages 实体 + MessageRole/MessageStatus 枚举 |
| `src/ai/dto/create-conversation.dto.ts` | `{model?}` |
| `src/ai/dto/send-message.dto.ts` | `{content, model?}` |
| `src/ai/dto/rename-conversation.dto.ts` | `{title}` |
| `src/db/migrations/<ts>-CreateAiTables.ts` | 迁移（生成后审查） |
| `src/common/interceptors/api-response.interceptor.ts` | 修改：SSE 路由放行信封 |
| `apps/backend/.env.example` | 修改：新增 AI 配置项 |

每个源文件配 `*.spec.ts` 同目录测试。

**关键约定（后端）：** ESM，相对导入必须带 `.js` 后缀；`users.id` 是 **bigint**（string），`CurrentUserPayload = { userId, jti }`；覆盖率门槛 80%，module/decorator/dto/migration 已在 exclude。

---

### 任务 1：安装依赖

**文件：**

- 修改：`apps/backend/package.json`、`pnpm-lock.yaml`

- [ ] **步骤 1：安装 langchain 依赖**

```bash
pnpm --filter @lucy/backend add @langchain/ollama @langchain/core
```

- [ ] **步骤 2：验证 ChatOllama 类型签名**

读 `node_modules/@langchain/ollama/dist/chat_models.d.ts`，确认：构造参数含 `baseUrl`、`model`；有 `stream(messages)` 返回 `Promise<IterableReadableStream<ChatGenerationChunk>>`（chunk.content 为 string）；有 `invoke(messages)` 返回 `AIMessage`。若 `baseUrl` 写作 `baseURL`，后续所有 `OllamaFactory` 代码以安装后签名为准。

- [ ] **步骤 3：typecheck 通过**

```bash
pnpm --filter @lucy/backend typecheck
```

预期：PASS（无代码变更，仅验证依赖可解析）。

- [ ] **步骤 4：Commit**

```bash
git add apps/backend/package.json pnpm-lock.yaml
git commit -m "chore(backend): 引入 @langchain/ollama 与 @langchain/core 依赖"
```

---

### 任务 2：实体 Conversation + Message

**文件：**

- 创建：`src/ai/entities/conversation.entity.ts`
- 创建：`src/ai/entities/message.entity.ts`

- [ ] **步骤 1：创建 Conversation 实体**

`src/ai/entities/conversation.entity.ts`：

```ts
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity.js';
import { Message } from './message.entity.js';

@Entity('ai_conversations')
export class Conversation {
  @ApiProperty({ description: '会话 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '归属用户 ID', example: '1' })
  @Index()
  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ApiHideProperty()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ApiProperty({ description: '标题', type: String, nullable: true })
  @Column({ type: 'varchar', length: 50, nullable: true })
  title: string | null;

  @ApiProperty({ description: '会话默认模型', type: String, nullable: true })
  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @ApiProperty({
    description: '消息列表',
    type: () => [Message],
    required: false,
  })
  @OneToMany(() => Message, (m) => m.conversation)
  messages?: Message[];

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

- [ ] **步骤 2：创建 Message 实体**

`src/ai/entities/message.entity.ts`：

```ts
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity.js';

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export enum MessageStatus {
  Complete = 'complete',
  Aborted = 'aborted',
  Failed = 'failed',
}

@Entity('ai_messages')
export class Message {
  @ApiProperty({ description: '消息 ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: '所属会话 ID' })
  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ApiHideProperty()
  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;

  @ApiProperty({ description: '角色', enum: MessageRole })
  @Column({ type: 'enum', enum: MessageRole })
  role: MessageRole;

  @ApiProperty({ description: '内容' })
  @Column({ type: 'text' })
  content: string;

  @ApiProperty({ description: '生成状态', enum: MessageStatus, nullable: true })
  @Column({ type: 'enum', enum: MessageStatus, nullable: true })
  status: MessageStatus | null;

  @ApiProperty({ description: '创建时间' })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

- [ ] **步骤 3：typecheck + 测试通过**

```bash
pnpm --filter @lucy/backend typecheck && pnpm --filter @lucy/backend test
```

预期：PASS（实体尚未被测试引用，不影响现有 57 个测试）。

- [ ] **步骤 4：Commit**

```bash
git add src/ai/entities
git commit -m "feat(ai): 新增 conversation 与 message 实体"
```

---

### 任务 3：生成并审查迁移

**文件：**

- 创建：`src/db/migrations/<ts>-CreateAiTables.ts`（生成后改名审查）

- [ ] **步骤 1：基于实体 diff 生成迁移**

```bash
pnpm --filter @lucy/backend exec tsx ./node_modules/typeorm/cli.js migration:generate src/db/migrations/CreateAiTables -d src/db/data-source.ts
```

前提：本地 Postgres 已启动、`apps/backend/.env` 已配置 DB 连接。

- [ ] **步骤 2：人工审查 up/down**

确认生成内容包含：`ai_conversations`（id uuid PK default gen_random_uuid、user_id bigint FK→users(id) ON DELETE CASCADE、title varchar(50)、model varchar、created_at/updated_at timestamptz）、`ai_messages`（id uuid PK、conversation_id uuid FK→ai_conversations(id) ON DELETE CASCADE、role/status 走 `CREATE TYPE "ai_messages_role_enum"`/`ai_messages_status_enum`、content text、created_at），及 user_id/conversation_id 索引。修正任何异常（如 FK 类型不匹配）。

- [ ] **步骤 3：执行迁移**

```bash
pnpm --filter @lucy/backend db:migrate
```

预期：迁移成功，`ai_conversations`、`ai_messages` 建表。

- [ ] **步骤 4：Commit**

```bash
git add src/db/migrations
git commit -m "feat(ai): 新增 ai_conversations 与 ai_messages 建表迁移"
```

---

### 任务 4：全局拦截器放行 SSE

`ApiResponseInterceptor` 的 `map` 会把 SSE 流每一帧包成 `{code,message,data}`，破坏 `{type,data}` 事件结构。SSE 路由需原样放行。

**文件：**

- 修改：`src/common/interceptors/api-response.interceptor.ts`
- 修改：`src/common/interceptors/api-response.interceptor.spec.ts`

- [ ] **步骤 1：编写失败测试（SSE 放行）**

在 `api-response.interceptor.spec.ts` 追加：

```ts
import { SSE_METADATA } from '@nestjs/common/constants';
import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';

describe('ApiResponseInterceptor', () => {
  // ...现有用例...

  it('SSE 路由不包裹信封，原样透传', async () => {
    const handler = () => {};
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const ctx = {
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as Parameters<typeof interceptor.intercept>[0];
    const next = { handle: () => of('raw frame') };
    const result = await lastValueFrom(interceptor.intercept(ctx, next));
    expect(result).toBe('raw frame');
  });
});
```

> 若 `@nestjs/common/constants` 无法在 ESM 下解析，改用字面量 `'sse:__sse__'`（该值由 `@nestjs/common` 的 `Sse` 装饰器写入，属稳定内部常量）。

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/common/interceptors/api-response.interceptor.spec.ts
```

预期：FAIL（新增用例——当前实现会把 `'raw frame'` 包成信封）。

- [ ] **步骤 3：修改拦截器**

`src/common/interceptors/api-response.interceptor.ts`：

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const isSse = Reflect.getMetadata(SSE_METADATA, ctx.getHandler());
    if (isSse) return next.handle();
    return next
      .handle()
      .pipe(map((data: unknown) => ({ code: 0, message: 'ok', data })));
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/common/interceptors/api-response.interceptor.spec.ts
```

预期：PASS（新旧用例全过）。

- [ ] **步骤 5：Commit**

```bash
git add src/common/interceptors/api-response.interceptor.ts src/common/interceptors/api-response.interceptor.spec.ts
git commit -m "fix(common): ApiResponseInterceptor 放行 SSE 路由，避免破坏事件结构"
```

---

### 任务 5：OllamaFactory（TDD）

**文件：**

- 创建：`src/ai/ollama.factory.ts`
- 创建：`src/ai/ollama.factory.spec.ts`

- [ ] **步骤 1：编写失败测试**

`src/ai/ollama.factory.spec.ts`：

```ts
import { ConfigService } from '@nestjs/config';
import { OllamaFactory } from './ollama.factory.js';

describe('OllamaFactory', () => {
  const config = new ConfigService({
    OLLAMA_MODEL: 'default-model',
    OLLAMA_BASE_URL: 'http://localhost:11434',
  });

  it('同一 model 返回同一实例（缓存）', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient('qwen')).toBe(factory.getClient('qwen'));
  });

  it('不同 model 返回不同实例', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient('a')).not.toBe(factory.getClient('b'));
  });

  it('未传 model 时使用配置默认模型', () => {
    const factory = new OllamaFactory(config);
    expect(factory.getClient()).toBe(factory.getClient('default-model'));
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/ollama.factory.spec.ts
```

预期：FAIL（找不到 `./ollama.factory.js`）。

- [ ] **步骤 3：实现 OllamaFactory**

`src/ai/ollama.factory.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOllama } from '@langchain/ollama';

@Injectable()
export class OllamaFactory {
  private readonly cache = new Map<string, ChatOllama>();

  constructor(private readonly config: ConfigService) {}

  getClient(model?: string): ChatOllama {
    const resolved =
      model ?? this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    const cached = this.cache.get(resolved);
    if (cached) return cached;
    const client = new ChatOllama({
      baseUrl: this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      ),
      model: resolved,
    });
    this.cache.set(resolved, client);
    return client;
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/ollama.factory.spec.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ai/ollama.factory.ts src/ai/ollama.factory.spec.ts
git commit -m "feat(ai): OllamaFactory 按 model 缓存 ChatOllama 实例"
```

---

### 任务 6：TokenizerService（TDD）

**文件：**

- 创建：`src/ai/tokenizer.service.ts`
- 创建：`src/ai/tokenizer.service.spec.ts`

- [ ] **步骤 1：编写失败测试**

`src/ai/tokenizer.service.spec.ts`：

```ts
import { ConfigService } from '@nestjs/config';
import { TokenizerService } from './tokenizer.service.js';

describe('TokenizerService', () => {
  const config = new ConfigService({
    OLLAMA_BASE_URL: 'http://localhost:11434',
  });

  afterEach(() => vi.unstubAllGlobals());

  it('调用 /api/tokenize 并返回 count', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ count: 42 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await expect(svc.countTokens('你好', 'qwen')).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tokenize',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('相同 (model, text) 命中缓存不再请求', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ count: 5 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await svc.countTokens('abc', 'qwen');
    await svc.countTokens('abc', 'qwen');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('请求失败时按字符数估算兜底', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const svc = new TokenizerService(config);
    await expect(svc.countTokens('你好世界', 'qwen')).resolves.toBe(2);
  });

  it('不同 model 缓存隔离', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ count: 3 }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TokenizerService(config);
    await svc.countTokens('x', 'a');
    await svc.countTokens('x', 'b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/tokenizer.service.spec.ts
```

预期：FAIL（找不到 `./tokenizer.service.js`）。

- [ ] **步骤 3：实现 TokenizerService**

`src/ai/tokenizer.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TokenizerService {
  // 缓存键：`${model}\u0000${text}`，避免嵌套 Map 增长失控
  private readonly cache = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async countTokens(text: string, model: string): Promise<number> {
    const key = `${model}\u0000${text}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const baseUrl = this.config.get<string>(
        'OLLAMA_BASE_URL',
        'http://localhost:11434',
      );
      const res = await fetch(`${baseUrl}/api/tokenize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res.ok) throw new Error(`tokenize failed: ${res.status}`);
      const data = (await res.json()) as { count: number };
      this.cache.set(key, data.count);
      return data.count;
    } catch {
      // Ollama 不可用时按字符数估算（中文约 0.5 token/字）
      return Math.ceil(text.length / 2);
    }
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/tokenizer.service.spec.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ai/tokenizer.service.ts src/ai/tokenizer.service.spec.ts
git commit -m "feat(ai): TokenizerService 调 Ollama /api/tokenize 计数（缓存+估算兜底）"
```

---

### 任务 7：ContextService（TDD）

**文件：**

- 创建：`src/ai/context.service.ts`
- 创建：`src/ai/context.service.spec.ts`

- [ ] **步骤 1：编写失败测试**

`src/ai/context.service.spec.ts`：

```ts
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ContextService } from './context.service.js';
import { TokenizerService } from './tokenizer.service.js';
import { Message, MessageRole } from './entities/message.entity.js';

describe('ContextService', () => {
  function makeConfig(overrides: Record<string, unknown> = {}) {
    return new ConfigService({
      AI_CONTEXT_TOKEN_LIMIT: 10,
      AI_CONTEXT_RESERVE_RATIO: 0.7,
      AI_SYSTEM_PROMPT: '',
      ...overrides,
    });
  }

  function makeSvc(overrides: Record<string, unknown> = {}) {
    const tokenizer = {
      countTokens: vi.fn().mockResolvedValue(5),
    } as unknown as TokenizerService;
    return new ContextService(makeConfig(overrides), tokenizer);
  }

  function msg(role: MessageRole, content: string): Message {
    return { role, content } as Message;
  }

  it('系统提示 + 预算内保留全部历史 + 新消息', async () => {
    const svc = makeSvc({ AI_SYSTEM_PROMPT: 'sys' });
    const history = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Assistant, 'a1'),
    ];
    const out = await svc.buildMessages(history, 'new', 'qwen');
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(out[1]).toBeInstanceOf(HumanMessage);
    expect(out[2]).toBeInstanceOf(AIMessage);
    expect(out[3]).toBeInstanceOf(HumanMessage);
    expect(out[3].content).toBe('new');
  });

  it('超预算时保留最近消息，丢弃更早', async () => {
    // 预算 floor(10*0.7)=7，每条 5 token → 只够最近 1 条
    const svc = makeSvc();
    const history = [
      msg(MessageRole.User, 'early'),
      msg(MessageRole.Assistant, 'recent'),
    ];
    const out = await svc.buildMessages(history, 'new', 'qwen');
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(AIMessage);
    expect(out[0].content).toBe('recent');
    expect(out[1]).toBeInstanceOf(HumanMessage);
  });

  it('空历史只返回系统提示与新消息', async () => {
    const svc = makeSvc({ AI_SYSTEM_PROMPT: 'sys' });
    const out = await svc.buildMessages([], 'new', 'qwen');
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(out[1]).toBeInstanceOf(HumanMessage);
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/context.service.spec.ts
```

预期：FAIL（找不到 `./context.service.js`）。

- [ ] **步骤 3：实现 ContextService**

`src/ai/context.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Message, MessageRole } from './entities/message.entity.js';
import { TokenizerService } from './tokenizer.service.js';

@Injectable()
export class ContextService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenizer: TokenizerService,
  ) {}

  async buildMessages(
    history: Message[],
    newContent: string,
    model: string,
  ): Promise<(SystemMessage | HumanMessage | AIMessage)[]> {
    const limit = this.config.get<number>('AI_CONTEXT_TOKEN_LIMIT', 4096);
    const reserveRatio = this.config.get<number>(
      'AI_CONTEXT_RESERVE_RATIO',
      0.7,
    );
    const budget = Math.floor(limit * reserveRatio);

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [];
    const systemPrompt = this.config.get<string>('AI_SYSTEM_PROMPT', '');
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));

    // 从最近往前累计，超预算即停
    const selected: Message[] = [];
    let used = 0;
    for (const m of [...history].reverse()) {
      const tokens = await this.tokenizer.countTokens(m.content, model);
      if (used + tokens > budget) break;
      selected.push(m);
      used += tokens;
    }

    for (const m of selected.reverse()) {
      if (m.role === MessageRole.User) {
        messages.push(new HumanMessage(m.content));
      } else if (m.role === MessageRole.Assistant) {
        messages.push(new AIMessage(m.content));
      }
      // system 角色仅来自配置注入，历史中的 system 行忽略
    }
    messages.push(new HumanMessage(newContent));
    return messages;
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/context.service.spec.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ai/context.service.ts src/ai/context.service.spec.ts
git commit -m "feat(ai): ContextService 按 token 预算截断会话历史"
```

---

### 任务 8：DTO + 校验测试

**文件：**

- 创建：`src/ai/dto/create-conversation.dto.ts`
- 创建：`src/ai/dto/send-message.dto.ts`
- 创建：`src/ai/dto/rename-conversation.dto.ts`
- 创建：`src/ai/dto/create-conversation.dto.spec.ts`
- 创建：`src/ai/dto/send-message.dto.spec.ts`

- [ ] **步骤 1：编写失败测试**

`src/ai/dto/send-message.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SendMessageDto } from './send-message.dto.js';

describe('SendMessageDto', () => {
  it('content 必填，为空校验失败', async () => {
    const dto = plainToInstance(SendMessageDto, { content: '' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('content 合法，model 可选', async () => {
    expect(
      await validate(plainToInstance(SendMessageDto, { content: 'hi' })),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(SendMessageDto, { content: 'hi', model: 'qwen' }),
      ),
    ).toHaveLength(0);
  });

  it('model 超长校验失败', async () => {
    const dto = plainToInstance(SendMessageDto, {
      content: 'hi',
      model: 'x'.repeat(200),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
```

`src/ai/dto/create-conversation.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateConversationDto } from './create-conversation.dto.js';

describe('CreateConversationDto', () => {
  it('空 body 合法（model 可选）', async () => {
    expect(
      await validate(plainToInstance(CreateConversationDto, {})),
    ).toHaveLength(0);
  });

  it('model 超长校验失败', async () => {
    const dto = plainToInstance(CreateConversationDto, {
      model: 'x'.repeat(200),
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/dto
```

预期：FAIL（DTO 文件不存在）。

- [ ] **步骤 3：实现 DTO**

`src/ai/dto/create-conversation.dto.ts`：

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({ description: '会话默认模型', example: 'qwen2.5:7b' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
```

`src/ai/dto/send-message.dto.ts`：

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ description: '用户消息内容', example: '你好' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({
    description: '本次请求模型覆盖',
    example: 'qwen2.5:7b',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
```

`src/ai/dto/rename-conversation.dto.ts`：

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameConversationDto {
  @ApiProperty({ description: '新标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title: string;
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/dto
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ai/dto
git commit -m "feat(ai): 会话/消息/改名 DTO 与校验"
```

---

### 任务 9：AiService（TDD）

**文件：**

- 创建：`src/ai/ai.service.ts`
- 创建：`src/ai/ai.service.spec.ts`

- [ ] **步骤 1：编写失败测试**

`src/ai/ai.service.spec.ts`：

```ts
import { ConfigService } from '@nestjs/config';
import { IsNull } from 'typeorm';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { AiService } from './ai.service.js';
import { ContextService } from './context.service.js';
import { Conversation } from './entities/conversation.entity.js';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';

describe('AiService', () => {
  const conversationRepo = {
    findOne: vi.fn(),
    save: vi.fn(),
    findAndCount: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const messageRepo = {
    save: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    count: vi.fn(),
  };
  const ollamaFactory = { getClient: vi.fn() };
  const contextService = { buildMessages: vi.fn() };
  const config = new ConfigService({ OLLAMA_MODEL: 'default-model' });

  let service: AiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AiService(
      conversationRepo as never,
      messageRepo as never,
      ollamaFactory as never,
      contextService as never,
      config as never,
    );
  });

  const conv = () =>
    Object.assign(new Conversation(), {
      id: 'c1',
      userId: '1',
      title: null,
      model: null,
    });

  it('create 保存会话', async () => {
    conversationRepo.save.mockResolvedValue(conv());
    await expect(service.create('1', {})).resolves.toBeInstanceOf(Conversation);
    expect(conversationRepo.save).toHaveBeenCalledWith({
      userId: '1',
      model: null,
    });
  });

  it('list 返回分页结果', async () => {
    conversationRepo.findAndCount.mockResolvedValue([[conv()], 1]);
    await expect(service.list('1', 1, 20)).resolves.toEqual({
      list: [expect.any(Conversation)],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('get 会话不存在抛错', async () => {
    conversationRepo.findOne.mockResolvedValue(null);
    await expect(service.get('1', 'x')).rejects.toThrow('会话不存在');
  });

  it('get 返回会话及消息', async () => {
    conversationRepo.findOne.mockResolvedValue(conv());
    messageRepo.find.mockResolvedValue([]);
    const res = await service.get('1', 'c1');
    expect(res.messages).toEqual([]);
  });

  it('rename 改名并返回', async () => {
    conversationRepo.findOne.mockResolvedValue(conv());
    conversationRepo.save.mockResolvedValue(conv());
    await service.rename('1', 'c1', '新标题');
    expect(conversationRepo.save).toHaveBeenCalled();
  });

  it('remove 删除会话，不存在抛错', async () => {
    conversationRepo.delete.mockResolvedValue({ affected: 1 });
    await expect(service.remove('1', 'c1')).resolves.toEqual({ success: true });
    conversationRepo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.remove('1', 'c1')).rejects.toThrow('会话不存在');
  });

  describe('sendMessage', () => {
    function fakeClient(overrides: Record<string, unknown> = {}) {
      return {
        async *stream() {
          yield { content: '你' };
          yield { content: '好' };
        },
        async invoke() {
          return { content: '标题' };
        },
        ...overrides,
      };
    }

    const events = (obs: ReturnType<AiService['sendMessage']>) =>
      lastValueFrom(obs.pipe(toArray()));

    it('正常流：逐帧 delta + done，落库 complete', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(result.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.User,
        content: 'hi',
      });
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Assistant,
        content: '你好',
        status: MessageStatus.Complete,
      });
    });

    it('中途抛错：落库 aborted（含半截内容）', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          async *stream() {
            yield { content: '半截' };
            throw new Error('boom');
          },
        }),
      );

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(result.map((e) => e.type)).toEqual(['delta', 'error']);
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Assistant,
        content: '半截',
        status: MessageStatus.Aborted,
      });
    });

    it('无内容即失败：落库 failed', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          async *stream() {
            throw new Error('no tokens');
          },
        }),
      );

      await events(service.sendMessage('1', 'c1', { content: 'hi' }));
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Assistant,
        content: '',
        status: MessageStatus.Failed,
      });
    });

    it('会话不属于当前用户：发 error 事件且不保存', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      const result = await events(
        service.sendMessage('1', 'x', { content: 'hi' }),
      );
      expect(result[result.length - 1].type).toBe('error');
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('首条消息触发标题生成', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(1);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      await events(service.sendMessage('1', 'c1', { content: 'hi' }));
      await vi.waitFor(() =>
        expect(conversationRepo.update).toHaveBeenCalled(),
      );
      expect(conversationRepo.update).toHaveBeenCalledWith(
        { id: 'c1', title: IsNull() },
        { title: '标题' },
      );
    });

    it('请求级 model 覆盖会话默认', async () => {
      conversationRepo.findOne.mockResolvedValue(
        Object.assign(new Conversation(), {
          id: 'c1',
          userId: '1',
          title: null,
          model: 'conv-model',
        }),
      );
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      await events(
        service.sendMessage('1', 'c1', { content: 'hi', model: 'req-model' }),
      );
      expect(ollamaFactory.getClient).toHaveBeenCalledWith('req-model');
    });
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/ai.service.spec.ts
```

预期：FAIL（找不到 `./ai.service.js`）。

- [ ] **步骤 3：实现 AiService**

`src/ai/ai.service.ts`：

```ts
import {
  Injectable,
  NotFoundException,
  type MessageEvent,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { IsNull, Repository } from 'typeorm';
import { ContextService } from './context.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { Conversation } from './entities/conversation.entity.js';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly ollamaFactory: OllamaFactory,
    private readonly contextService: ContextService,
    private readonly config: ConfigService,
  ) {}

  create(userId: string, dto: CreateConversationDto): Promise<Conversation> {
    return this.conversationRepo.save({ userId, model: dto.model ?? null });
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    list: Conversation[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [list, total] = await this.conversationRepo.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async get(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    conversation.messages = await this.messageRepo.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
    return conversation;
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    conversation.title = title;
    return this.conversationRepo.save(conversation);
  }

  async remove(userId: string, id: string): Promise<{ success: true }> {
    const result = await this.conversationRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('会话不存在');
    return { success: true };
  }

  sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.runSend(subscriber, userId, conversationId, dto).catch((err) => {
        subscriber.next({
          type: 'error',
          data: err instanceof Error ? err.message : '生成失败',
        });
        subscriber.complete();
      });
    });
  }

  private async runSend(
    subscriber: { next: (e: MessageEvent) => void; complete: () => void },
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<void> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      subscriber.next({ type: 'error', data: '会话不存在' });
      subscriber.complete();
      return;
    }

    await this.messageRepo.save({
      conversationId,
      role: MessageRole.User,
      content: dto.content,
    });

    const count = await this.messageRepo.count({ where: { conversationId } });
    if (count === 1) {
      void this.generateTitle(conversation).catch(() => {});
    }

    const model =
      dto.model ??
      conversation.model ??
      this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    const client = this.ollamaFactory.getClient(model);

    const history = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
    const messages = await this.contextService.buildMessages(
      history,
      dto.content,
      model,
    );

    let full = '';
    try {
      const stream = await client.stream(messages);
      for await (const chunk of stream) {
        const text = chunk.content;
        if (typeof text === 'string' && text.length > 0) {
          full += text;
          subscriber.next({ type: 'delta', data: text });
        }
      }
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Assistant,
        content: full,
        status: MessageStatus.Complete,
      });
      subscriber.next({ type: 'done', data: '' });
      subscriber.complete();
    } catch {
      const status = full ? MessageStatus.Aborted : MessageStatus.Failed;
      await this.messageRepo.save({
        conversationId,
        role: MessageRole.Assistant,
        content: full,
        status,
      });
      subscriber.next({
        type: 'error',
        data: status === MessageStatus.Aborted ? '生成中断' : '生成失败',
      });
      subscriber.complete();
    }
  }

  private async generateTitle(conversation: Conversation): Promise<void> {
    const first = await this.messageRepo.findOne({
      where: { conversationId: conversation.id, role: MessageRole.User },
      order: { createdAt: 'ASC' },
    });
    if (!first) return;
    const client = this.ollamaFactory.getClient(
      conversation.model ?? undefined,
    );
    const prompt = this.config.get<string>(
      'AI_TITLE_PROMPT',
      '为这段对话生成一个不超过20字的简短标题，只输出标题本身：',
    );
    const res = await client.invoke([
      new HumanMessage(`${prompt}${first.content}`),
    ]);
    const title = String(res.content ?? '')
      .trim()
      .slice(0, 50);
    if (title) {
      await this.conversationRepo.update(
        { id: conversation.id, title: IsNull() },
        { title },
      );
    }
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/ai.service.spec.ts
```

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/ai/ai.service.ts src/ai/ai.service.spec.ts
git commit -m "feat(ai): AiService 会话 CRUD + SSE 发消息（含兜底落库与标题生成）"
```

---

### 任务 10：AiController（含测试）

**文件：**

- 创建：`src/ai/ai.controller.ts`
- 创建：`src/ai/ai.controller.spec.ts`

- [ ] **步骤 1：编写测试**

`src/ai/ai.controller.spec.ts`：

```ts
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

describe('AiController', () => {
  const aiService = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    sendMessage: vi.fn(),
  };
  let controller: AiController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AiController(aiService as never);
  });

  const user = { userId: '1', jti: 'j' };

  it('create 透传 userId 与 dto', async () => {
    await controller.create(user, { model: 'qwen' });
    expect(aiService.create).toHaveBeenCalledWith('1', { model: 'qwen' });
  });

  it('list 透传分页参数并转数字', async () => {
    await controller.list(user, '2', '10');
    expect(aiService.list).toHaveBeenCalledWith('1', 2, 10);
  });

  it('get/rename/remove 透传', async () => {
    await controller.get(user, 'c1');
    await controller.rename(user, 'c1', { title: '新' });
    await controller.remove(user, 'c1');
    expect(aiService.get).toHaveBeenCalledWith('1', 'c1');
    expect(aiService.rename).toHaveBeenCalledWith('1', 'c1', '新');
    expect(aiService.remove).toHaveBeenCalledWith('1', 'c1');
  });

  it('sendMessage 返回 service 的流', async () => {
    const obs = { subscribe: vi.fn() };
    aiService.sendMessage.mockReturnValue(obs);
    expect(controller.send(user, 'c1', { content: 'hi' })).toBe(obs);
    expect(aiService.sendMessage).toHaveBeenCalledWith('1', 'c1', {
      content: 'hi',
    });
  });
});
```

- [ ] **步骤 2：运行验证失败**

```bash
pnpm --filter @lucy/backend test src/ai/ai.controller.spec.ts
```

预期：FAIL（找不到 `./ai.controller.js`）。

- [ ] **步骤 3：实现 AiController**

`src/ai/ai.controller.ts`：

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { AiService } from './ai.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { RenameConversationDto } from './dto/rename-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { Conversation } from './entities/conversation.entity.js';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('conversations')
  @ApiOperation({ summary: '创建会话', description: '新建一个 AI 对话会话' })
  @ApiResponse({ status: 201, description: '创建成功', type: Conversation })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateConversationDto,
  ): Promise<Conversation> {
    return this.aiService.create(user.userId, dto);
  }

  @Get('conversations')
  @ApiOperation({ summary: '会话列表', description: '按更新时间倒序分页' })
  @ApiResponse({ status: 200, description: '返回 PageResult<Conversation>' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.aiService.list(user.userId, Number(page), Number(pageSize));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话详情', description: '含消息列表（时间正序）' })
  @ApiResponse({
    status: 200,
    description: '返回会话及消息',
    type: Conversation,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<Conversation> {
    return this.aiService.get(user.userId, id);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: '改名', description: '修改会话标题' })
  @ApiResponse({
    status: 200,
    description: '返回更新后会话',
    type: Conversation,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  rename(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RenameConversationDto,
  ): Promise<Conversation> {
    return this.aiService.rename(user.userId, id, dto.title);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除会话', description: '级联删除该会话全部消息' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '会话不存在' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    return this.aiService.remove(user.userId, id);
  }

  // 注意：@Post 必须写在 @Sse 上方——@Sse 内部把 HTTP 方法置为 GET，@Post 在上方覆盖回 POST
  @Post('conversations/:id/messages')
  @Sse('conversations/:id/messages')
  @ApiOperation({
    summary: '发送消息',
    description: 'SSE 流式返回模型回复，事件：delta/done/error',
  })
  send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Observable<MessageEvent> {
    return this.aiService.sendMessage(user.userId, id, dto);
  }
}
```

- [ ] **步骤 4：运行验证通过**

```bash
pnpm --filter @lucy/backend test src/ai/ai.controller.spec.ts
```

预期：PASS。

- [ ] **步骤 5：手动冒烟验证 SSE（可选，需 Ollama 运行）**

启动后端，用 curl 模拟（先登录拿 token）：

```bash
curl -N -X POST http://localhost:3000/ai/conversations/<id>/messages \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"content":"你好"}' --max-time 30
```

预期：收到 `event: delta` / `event: done` 行。（若路由注册成了 GET 而非 POST，说明装饰器顺序未生效，改用 `@Res()` 手动流式方案：见风险小节。）

- [ ] **步骤 6：Commit**

```bash
git add src/ai/ai.controller.ts src/ai/ai.controller.spec.ts
git commit -m "feat(ai): AiController 会话 REST 接口 + SSE 发消息端点"
```

---

### 任务 11：AiModule 装配 + 接入 AppModule

**文件：**

- 创建：`src/ai/ai.module.ts`
- 修改：`src/app.module.ts`

- [ ] **步骤 1：创建 AiModule**

`src/ai/ai.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { ContextService } from './context.service.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';
import { OllamaFactory } from './ollama.factory.js';
import { TokenizerService } from './tokenizer.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message])],
  controllers: [AiController],
  providers: [AiService, OllamaFactory, TokenizerService, ContextService],
})
export class AiModule {}
```

- [ ] **步骤 2：AppModule 引入 AiModule**

`src/app.module.ts` 的 imports 数组中，在 `AuthModule` 之后加：

```ts
import { AiModule } from './ai/ai.module.js';
// ...
imports: [
  // ...现有
  AuthModule,
  AiModule,
],
```

- [ ] **步骤 3：typecheck + 全量测试通过**

```bash
pnpm --filter @lucy/backend typecheck && pnpm --filter @lucy/backend test
```

预期：PASS。

- [ ] **步骤 4：Commit**

```bash
git add src/ai/ai.module.ts src/app.module.ts
git commit -m "feat(ai): AiModule 装配并接入 AppModule"
```

---

### 任务 12：typegen 重新生成 shared 契约

**文件：**

- 修改：`packages/shared/src/generated/openapi.ts`（生成物，勿手改）

- [ ] **步骤 1：重新生成**

```bash
pnpm typegen
```

预期：成功。检查 `packages/shared/src/generated/openapi.ts` 新增 `/ai/conversations` 等路径与 `Conversation`/`Message` schema。

- [ ] **步骤 2：验证共享契约可消费**

```bash
pnpm --filter @lucy/shared build && pnpm typecheck
```

预期：PASS。

- [ ] **步骤 3：Commit**

```bash
git add packages/shared/src/generated/openapi.ts
git commit -m "chore(shared): 重新生成契约类型，纳入 ai 会话/消息 schema"
```

---

### 任务 13：.env.example 配置

**文件：**

- 修改：`apps/backend/.env.example`

- [ ] **步骤 1：追加 AI 配置块**

`apps/backend/.env.example` 末尾追加：

```bash
# AI 对话（Ollama + LangChain）
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
AI_CONTEXT_TOKEN_LIMIT=4096
AI_CONTEXT_RESERVE_RATIO=0.7
AI_SYSTEM_PROMPT=
AI_TITLE_PROMPT=为这段对话生成一个不超过20字的简短标题，只输出标题本身：
```

- [ ] **步骤 2：同步本地 .env（如无）**

复制同值到 `apps/backend/.env`（.env 已 gitignore，仅供本地运行）。

- [ ] **步骤 3：Commit**

```bash
git add apps/backend/.env.example
git commit -m "chore(backend): .env.example 新增 AI 对话配置项"
```

---

### 任务 14：收尾验证

**文件：**

- 全部新增/修改文件

- [ ] **步骤 1：全量检查**

```bash
pnpm typecheck && pnpm test
```

预期：全绿。

- [ ] **步骤 2：覆盖率检查**

```bash
pnpm --filter @lucy/backend test:cov
```

预期：各指标 ≥80%（AI 服务/工厂/tokenizer/context 均已被 spec 覆盖；实体经测试中 `new Conversation()`/`Object.assign` 构造覆盖）。

> 若覆盖率低于 80%（`Message` 实体无 `new` 构造、类装饰器行可能未计），在 `src/ai/ai.service.spec.ts` 增加一条用例或在 `src/ai/entities/message.entity.spec.ts` 补 `Object.assign(new Message(), {...})` 构造断言，确保实体文件被执行。

- [ ] **步骤 3：运行时冒烟（需 Ollama + DB）**

登录 → 创建会话 → SSE 发消息 → 列表/详情/改名/删除。确认：首条消息后 title 被异步填充、`ai_messages` 出现 user 与 assistant 两行。

---

## 风险与取舍

- **`@Sse` + `@Post` 方法覆盖**：依赖「@Post 写在 @Sse 上方」的装饰器执行顺序（自下而上，@Post 最后覆盖 method 为 POST）。若冒烟发现注册成 GET，改用手动流式：controller 用 `@Res()` + `res.write('event: delta\ndata: ...\n\n')`，AiService 增加 `streamToRes` 方法写响应——改动局限在 controller/service 两处。
- **`@nestjs/common/constants` ESM 解析**：若无法导入 `SSE_METADATA`，任务 4 用字面量 `'sse:__sse__'`。
- **迁移生成**：`migration:generate` 需本地 DB 在线且 `.env` 配好；若 DB 未起，等起好再执行任务 3。
- **`ChatOllama` 构造参数**：以安装后 `node_modules/@langchain/ollama` 类型为准（`baseUrl` vs `baseURL`），任务 1 已校验。
- **标题生成**：失败静默（title 保持 null），不重试；首条消息触发条件为「保存用户消息后 count===1」。
