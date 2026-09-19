import { ErrorCode } from '@lucy/shared';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { DataSource, IsNull } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { encodeCursor } from '../common/pagination/cursor.js';
import { DEFAULT_PAGE_SIZE } from '../common/pagination/pagination.constants.js';
import { PaginationModule } from '../common/pagination/pagination.module.js';
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
    createQueryBuilder: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const messageRepo = {
    save: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    count: vi.fn(),
  };
  // DataSource mock：transaction 调用回调并传入 manager
  const dataSource = {
    transaction: vi.fn((cb: (manager: unknown) => unknown) => {
      const manager = {
        getRepository: vi.fn((entity: unknown) => {
          if (entity === Message) return messageRepo;
          if (entity === Conversation) return conversationRepo;
          return {};
        }),
      };
      return cb(manager);
    }),
  } as unknown as DataSource;
  const ollamaFactory = { getClient: vi.fn() };
  const contextService = { buildMessages: vi.fn() };
  const config = new ConfigService({ OLLAMA_MODEL: 'default-model' });
  const logger = { log: vi.fn(), warn: vi.fn() } as unknown as AppLogger;

  let service: AiService;

  /**
   * 经 DI 容器装配：`@InjectRepository`/`@InjectDataSource` 的 token 是否与生产一致由容器判定。
   * 手工 `new AiService(...)` 时漏注入/错位只表现为运行时的 undefined，且每新增一个构造依赖
   * 都要在每个手工构造点补位置参数（`as never` 还会把类型错误一起抹掉）。
   *
   * `KeysetPaginator` 与 `knowledge.service.spec.ts` 同法：刻意不在这里 provide，而是走
   * `imports: [PaginationModule]` —— 与生产一致的模块路径才会验证 `PaginationModule` 真的
   * exports 了它，在 providers 里再 provide 一份会把 `ai.module.ts` 的 imports 写错也变成绿灯。
   * @param configService 覆盖 ConfigService（空闲超时用例需要不同的 OLLAMA_TIMEOUT_MS）
   */
  const buildModule = (configService: ConfigService = config) =>
    Test.createTestingModule({
      imports: [PaginationModule],
      providers: [
        AiService,
        { provide: AppLogger, useValue: logger },
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepo,
        },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: OllamaFactory, useValue: ollamaFactory },
        { provide: ContextService, useValue: contextService },
        { provide: ConfigService, useValue: configService },
      ],
    });

  const buildService = async (
    configService: ConfigService = config,
  ): Promise<AiService> => {
    const moduleRef = await buildModule(configService).compile();
    return moduleRef.get(AiService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service = await buildService();
  });

  const conv = () =>
    Object.assign(new Conversation(), {
      id: 'c1',
      userId: '1',
      title: null,
      model: null,
    });

  /** 带排序键时间戳的会话：真 paginator 会用 updatedAt 生成游标，所以必须给真实 Date */
  const timedConv = (index: number): Conversation =>
    Object.assign(conv(), {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 5, 1, 0, 0, 0, index)),
    });

  /**
   * 会话列表的 QueryBuilder stub：只实现 `KeysetPaginator` 用到的能力（链式排序/多取一条 +
   * 「属性名 → 列名」的实体元数据解析）。容器里给的是真 paginator（走 `PaginationModule`），
   * 所以列名解析写错就会拼出不存在的列 —— 这正是这里不拿 spy 顶替它的原因。
   */
  const makeListQueryBuilder = (rows: Conversation[]) => {
    const columns: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      id: 'id',
    };
    const qb = {
      expressionMap: {
        mainAlias: {
          name: 'c',
          hasMetadata: true,
          metadata: {
            name: 'Conversation',
            findColumnWithPropertyName: (property: string) =>
              columns[property]
                ? { databaseName: columns[property] }
                : undefined,
          },
        },
      },
      where: vi.fn(),
      orderBy: vi.fn(),
      addOrderBy: vi.fn(),
      andWhere: vi.fn(),
      take: vi.fn(),
      getMany: vi.fn().mockResolvedValue(rows),
    };
    qb.where.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.addOrderBy.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    return qb;
  };

  it('create 保存会话', async () => {
    conversationRepo.save.mockResolvedValue(conv());
    await expect(service.create('1', {})).resolves.toBeInstanceOf(Conversation);
    expect(conversationRepo.save).toHaveBeenCalledWith({
      userId: '1',
      model: null,
    });
  });

  /** 列表项允许式白名单的键集（已排序，与 `Object.keys(...).sort()` 比对） */
  const itemKeys = ['createdAt', 'id', 'model', 'title', 'updatedAt'];

  it('list 走游标分页：过滤归属用户，按 updatedAt 排序，列表项走允许式白名单', async () => {
    const row = Object.assign(timedConv(1), {
      title: '会话标题',
      model: 'qwen2.5:7b',
    });
    const qb = makeListQueryBuilder([row]);
    conversationRepo.createQueryBuilder.mockReturnValue(qb);

    const page = await service.list('1', undefined, undefined);

    expect(page.nextCursor).toBeNull();
    // 期望值逐字段显式写出、不引用生产 mapper：否则映射器漏拷/错拷字段时这里会恒等通过
    expect(page.list).toEqual([
      {
        id: row.id,
        title: '会话标题',
        model: 'qwen2.5:7b',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    ]);
    // 白名单：不含 userId 等实体字段（拿实体当契约等于「新增字段默认出网」）
    expect(Object.keys(page.list[0]).sort()).toEqual(itemKeys);
    expect(conversationRepo.createQueryBuilder).toHaveBeenCalledWith('c');
    expect(qb.where).toHaveBeenCalledWith('c.userId = :userId', {
      userId: '1',
    });
    // 排序键必须是 updated_at（最近活跃优先）；回落成 created_at 会变成「按创建时间」
    expect(qb.orderBy).toHaveBeenCalledWith('c.updated_at', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('c.id', 'DESC');
    // 多取一条判下一页，避免额外的 COUNT
    expect(qb.take).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE + 1);
  });

  it('list 带游标：追加行比较谓词，多取到一条时给出下一页游标', async () => {
    const rows = [timedConv(1), timedConv(2), timedConv(3)];
    const qb = makeListQueryBuilder(rows);
    conversationRepo.createQueryBuilder.mockReturnValue(qb);
    const last = timedConv(9);

    const page = await service.list(
      '1',
      encodeCursor(last.updatedAt, last.id, 'updatedAt'),
      2,
    );

    expect(qb.take).toHaveBeenCalledWith(3);
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(c.updated_at, c.id) < (:cursorTs, :cursorId)',
      { cursorTs: last.updatedAt, cursorId: last.id },
    );
    expect(page.list).toHaveLength(2);
    // 同上：逐字段写期望，且这条裁剪路径也要断言形状（此前没有）
    expect(page.list[0]).toEqual({
      id: rows[0].id,
      title: rows[0].title,
      model: rows[0].model,
      createdAt: rows[0].createdAt,
      updatedAt: rows[0].updatedAt,
    });
    expect(Object.keys(page.list[0]).sort()).toEqual(itemKeys);
    expect(page.list.map((item) => item.id)).toEqual([rows[0].id, rows[1].id]);
    expect(page.nextCursor).toBe(
      encodeCursor(rows[1].updatedAt, rows[1].id, 'updatedAt'),
    );
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
    await expect(service.remove('1', 'c1')).resolves.toBeNull();
    conversationRepo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.remove('1', 'c1')).rejects.toThrow('会话不存在');
  });

  describe('sendMessage', () => {
    function fakeClient(overrides: Record<string, unknown> = {}) {
      return {
        *stream() {
          yield { content: '你' };
          yield { content: '好' };
        },
        invoke() {
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
        role: MessageRole.Ai,
        content: '你好',
        thinking: null,
        status: MessageStatus.Complete,
        truncated: false,
      });
    });

    it('长度截断（done_reason=length）：done 帧标记 truncated，finish_reason=length', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          *stream() {
            yield { content: '半截' };
            yield {
              content: '',
              response_metadata: { done_reason: 'length' },
            };
          },
        }),
      );

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(result.map((e) => e.type)).toEqual(['delta', 'done']);
      expect(result.at(-1)).toMatchObject({
        type: 'done',
        data: { finish_reason: 'length', truncated: true },
      });
      // 截断状态须持久化：刷新/重开会话后仍可识别半截回答
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Ai,
        content: '半截',
        thinking: null,
        status: MessageStatus.Complete,
        truncated: true,
      });
    });

    it('中途抛错：落库 failed（含半截内容）', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          *stream() {
            yield { content: '半截' };
            throw new Error('boom');
          },
        }),
      );

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(result.map((e) => e.type)).toEqual(['delta', 'error']);
      expect(result[1]).toMatchObject({
        type: 'error',
        data: { code: ErrorCode.AI_GENERATE_FAILED, message: '生成失败' },
      });
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Ai,
        content: '半截',
        thinking: null,
        status: MessageStatus.Failed,
      });
    });

    it('模型超时：发超时错误码，落库 failed', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          *stream() {
            yield { content: '半截' };
            throw new Error('request timed out');
          },
        }),
      );

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(result.map((e) => e.type)).toEqual(['delta', 'error']);
      expect(result[1]).toMatchObject({
        type: 'error',
        data: { code: ErrorCode.AI_GENERATE_TIMEOUT, message: '模型调用超时' },
      });
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Ai,
        content: '半截',
        thinking: null,
        status: MessageStatus.Failed,
      });
    });

    it('空闲超时：无输出触发超时错误码并落库 failed', async () => {
      vi.useFakeTimers();
      try {
        service = await buildService(
          new ConfigService({
            OLLAMA_MODEL: 'default-model',
            OLLAMA_TIMEOUT_MS: 1000,
          }),
        );
        conversationRepo.findOne.mockResolvedValue(conv());
        messageRepo.count.mockResolvedValue(2);
        messageRepo.find.mockResolvedValue([]);
        contextService.buildMessages.mockResolvedValue([]);
        ollamaFactory.getClient.mockReturnValue(
          fakeClient({
            async *stream() {
              yield { content: '你' };
              await new Promise(() => {}); // 模型挂起：无后续输出
            },
          }),
        );

        const resultPromise = events(
          service.sendMessage('1', 'c1', { content: 'hi' }),
        );
        await vi.advanceTimersByTimeAsync(1000);
        const result = await resultPromise;
        expect(result.map((e) => e.type)).toEqual(['delta', 'error']);
        expect(result[1]).toMatchObject({
          type: 'error',
          data: {
            code: ErrorCode.AI_GENERATE_TIMEOUT,
            message: '模型调用超时',
          },
        });
        expect(messageRepo.save).toHaveBeenCalledWith({
          conversationId: 'c1',
          role: MessageRole.Ai,
          content: '你',
          thinking: null,
          status: MessageStatus.Failed,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('无内容即失败：落库 failed', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          stream() {
            throw new Error('no tokens');
          },
        }),
      );

      await events(service.sendMessage('1', 'c1', { content: 'hi' }));
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Ai,
        content: '',
        thinking: null,
        status: MessageStatus.Failed,
      });
    });

    it('会话不属于当前用户：发 error 事件且不保存', async () => {
      conversationRepo.findOne.mockResolvedValue(null);
      const result = await events(
        service.sendMessage('1', 'x', { content: 'hi' }),
      );
      expect(result[result.length - 1]).toMatchObject({
        type: 'error',
        data: { code: ErrorCode.AI_CONVERSATION_NOT_FOUND },
      });
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('首条消息触发标题生成', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(1);
      messageRepo.find.mockResolvedValue([]);
      messageRepo.findOne.mockResolvedValue(
        Object.assign(new Message(), {
          conversationId: 'c1',
          role: MessageRole.User,
          content: 'hi',
        }),
      );
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
      expect(ollamaFactory.getClient).toHaveBeenCalledWith('req-model', false);
    });

    it('请求级 reasoning 透传给模型客户端', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      await events(
        service.sendMessage('1', 'c1', { content: 'hi', reasoning: true }),
      );
      expect(ollamaFactory.getClient).toHaveBeenCalledWith(
        'default-model',
        true,
      );
    });

    it('思考流：thinking 与 content 分为两路 delta，落库全文', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          *stream() {
            yield {
              content: '',
              additional_kwargs: { reasoning_content: '先思考' },
            };
            yield { content: '最终回答' };
          },
        }),
      );

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      // 思考与回答分为不同帧：思考帧只带 thinking，回答帧只带 content
      expect(result.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
      expect(result[0]).toMatchObject({
        type: 'delta',
        data: { thinking: '先思考' },
      });
      expect(result[1]).toMatchObject({
        type: 'delta',
        data: { content: '最终回答' },
      });
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'c1',
        role: MessageRole.Ai,
        content: '最终回答',
        thinking: '先思考',
        status: MessageStatus.Complete,
        truncated: false,
      });
    });

    it('用户消息只进上下文一次：历史读取先于保存，buildMessages 收到不含本次内容的 history', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);

      // 模拟数据库状态：find 返回已保存消息的快照，save 会追加
      const db: unknown[] = [
        Object.assign(new Message(), {
          conversationId: 'c1',
          role: MessageRole.User,
          content: '之前的问题',
        }),
        Object.assign(new Message(), {
          conversationId: 'c1',
          role: MessageRole.Ai,
          content: '之前的回答',
        }),
      ];
      messageRepo.find.mockImplementation(() => [...db]);
      messageRepo.save.mockImplementation((m: unknown) => {
        db.push(m);
        return m;
      });
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      await events(service.sendMessage('1', 'c1', { content: '新的问题' }));

      // history 只含前序消息，本次用户消息作为第二个参数单独传入
      expect(contextService.buildMessages).toHaveBeenCalledWith(
        expect.not.arrayContaining([
          expect.objectContaining({ content: '新的问题' }),
        ]),
        '新的问题',
        'default-model',
      );
      // 历史读取先于用户消息保存，避免模型收到重复消息
      const findOrder = messageRepo.find.mock.invocationCallOrder[0];
      const userSaveOrder = messageRepo.save.mock.invocationCallOrder[0];
      expect(findOrder).toBeLessThan(userSaveOrder);
    });

    it('发消息后显式刷新会话 updatedAt：save 前设置为当前时间', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      conversationRepo.save.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      await events(service.sendMessage('1', 'c1', { content: 'hi' }));

      const saved = conversationRepo.save.mock.calls.find(
        ([c]) => (c as { id: string }).id === 'c1',
      )?.[0] as { id: string; userId: string } | undefined;
      expect(saved).toMatchObject({ id: 'c1', userId: '1' });
      // 显式设 updatedAt，确保脏检查必触发 UPDATE、不依赖 UpdateDateColumn
      expect(saved).toHaveProperty('updatedAt', expect.any(Date));
    });

    it('订阅中途取消 → stream 收到 signal 且已 abort，半截内容落 aborted', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      const captured: { signal?: AbortSignal } = {};
      let release: (() => void) | undefined;
      // 门闩：生成器在首帧后挂起，等测试决定是否中止，避免时序竞态
      const gate = new Promise<void>((resolve) => (release = resolve));
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          async *stream(_messages: Message[], opts?: { signal?: AbortSignal }) {
            captured.signal = opts?.signal;
            yield { content: '半截' };
            await gate;
            if (opts?.signal?.aborted) throw new Error('aborted');
            yield { content: '好' };
          },
        }),
      );

      const sub = service.sendMessage('1', 'c1', { content: 'hi' }).subscribe();
      await vi.waitFor(() => expect(captured.signal).toBeDefined());
      sub.unsubscribe();
      expect(captured.signal?.aborted).toBe(true);
      release?.();
      await vi.waitFor(() =>
        expect(messageRepo.save).toHaveBeenCalledWith({
          conversationId: 'c1',
          role: MessageRole.Ai,
          content: '半截',
          thinking: null,
          status: MessageStatus.Aborted,
        }),
      );
    });

    it('并发发送同会话：第二次立即收到 error，不重复执行', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(
        fakeClient({
          async *stream() {
            yield { content: '半截' };
            await new Promise(() => {}); // 永不结束，保持第一次在途
          },
        }),
      );

      const inFlight = (
        service as unknown as { inFlight: Map<string, unknown> }
      ).inFlight;
      const sub = service.sendMessage('1', 'c1', { content: 'hi' }).subscribe();
      expect(inFlight.has('c1')).toBe(true);

      const result = await events(
        service.sendMessage('1', 'c1', { content: 'hi2' }),
      );
      expect(result.map((e) => e.type)).toEqual(['error']);
      expect(result[0]).toMatchObject({
        type: 'error',
        data: {
          code: ErrorCode.AI_CONVERSATION_BUSY,
          message: '该会话正在生成中，请稍候',
        },
      });
      // runSend 为异步链路，等其真正走到 client 创建，确认第二次未重复执行
      await vi.waitFor(() =>
        expect(ollamaFactory.getClient).toHaveBeenCalledTimes(1),
      );
      sub.unsubscribe();
    });

    it('串行发送：前一次完成后可正常发送', async () => {
      conversationRepo.findOne.mockResolvedValue(conv());
      messageRepo.count.mockResolvedValue(2);
      messageRepo.find.mockResolvedValue([]);
      contextService.buildMessages.mockResolvedValue([]);
      ollamaFactory.getClient.mockReturnValue(fakeClient());

      const inFlight = (
        service as unknown as { inFlight: Map<string, unknown> }
      ).inFlight;
      const first = await events(
        service.sendMessage('1', 'c1', { content: 'hi' }),
      );
      expect(first.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
      // finally 在 observable 完成后微任务中删除锁，等锁清空再发第二次
      await vi.waitFor(() => expect(inFlight.has('c1')).toBe(false));
      const second = await events(
        service.sendMessage('1', 'c1', { content: 'hi2' }),
      );
      expect(second.map((e) => e.type)).toEqual(['delta', 'delta', 'done']);
    });
  });
});
