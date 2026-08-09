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
          stream() {
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
      expect(ollamaFactory.getClient).toHaveBeenCalledWith('req-model');
    });
  });
});
