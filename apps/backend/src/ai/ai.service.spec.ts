import { ErrorCode } from '@lucy/shared';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { IsNull } from 'typeorm';
import { AiService } from './ai.service.js';
import { Conversation } from './entities/conversation.entity.js';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';

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
      config,
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
        service = new AiService(
          conversationRepo as never,
          messageRepo as never,
          ollamaFactory as never,
          contextService as never,
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
