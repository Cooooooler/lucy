import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { ModelClientFactory } from '../model-provider/model-client.factory.js';
import { makeModelProvider } from '../test/model-provider.fixtures.js';
import { ConversationTitleService } from './conversation-title.service.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';

describe('ConversationTitleService', () => {
  const conversationRepo = { update: vi.fn() };
  const messageRepo = { findOne: vi.fn() };
  const modelClientFactory = { buildChat: vi.fn() };
  const config = new ConfigService({ AI_TITLE_PROMPT: '标题：' });
  const provider = makeModelProvider();

  let service: ConversationTitleService;

  const buildService = async (
    configService: ConfigService = config,
  ): Promise<ConversationTitleService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationTitleService,
        { provide: ConfigService, useValue: configService },
        { provide: ModelClientFactory, useValue: modelClientFactory },
        {
          provide: getRepositoryToken(Conversation),
          useValue: conversationRepo,
        },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
      ],
    }).compile();
    return moduleRef.get(ConversationTitleService);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service = await buildService();
  });

  const conv = () =>
    Object.assign(new Conversation(), { id: 'c1', modelProviderId: null });
  const signal = () => new AbortController().signal;
  const client = (invoke: () => Promise<{ content: unknown }>) => ({ invoke });

  it('按首条用户消息生成标题并写回（trim + 截断，且仅在标题为空时写）', async () => {
    messageRepo.findOne.mockResolvedValue(
      Object.assign(new Message(), { content: 'hi' }),
    );
    modelClientFactory.buildChat.mockReturnValue(
      client(() => Promise.resolve({ content: '  标题  ' })),
    );

    await service.generate(conv(), provider, signal());

    expect(modelClientFactory.buildChat).toHaveBeenCalledWith(provider);
    expect(conversationRepo.update).toHaveBeenCalledWith(
      { id: 'c1', title: IsNull() },
      { title: '标题' },
    );
  });

  it('没有用户消息时不调用模型、不写回', async () => {
    messageRepo.findOne.mockResolvedValue(null);
    await service.generate(conv(), provider, signal());
    expect(modelClientFactory.buildChat).not.toHaveBeenCalled();
    expect(conversationRepo.update).not.toHaveBeenCalled();
  });

  it('模型返回空标题时不写回', async () => {
    messageRepo.findOne.mockResolvedValue(
      Object.assign(new Message(), { content: 'hi' }),
    );
    modelClientFactory.buildChat.mockReturnValue(
      client(() => Promise.resolve({ content: '   ' })),
    );
    await service.generate(conv(), provider, signal());
    expect(conversationRepo.update).not.toHaveBeenCalled();
  });

  it('模型挂起：超时后上抛（不写回），避免拖住正文流', async () => {
    service = await buildService(
      new ConfigService({ AI_TITLE_PROMPT: '标题：', OLLAMA_TIMEOUT_MS: 10 }),
    );
    messageRepo.findOne.mockResolvedValue(
      Object.assign(new Message(), { content: 'hi' }),
    );
    modelClientFactory.buildChat.mockReturnValue(
      client(() => new Promise(() => {})),
    );

    await expect(service.generate(conv(), provider, signal())).rejects.toThrow(
      '标题生成超时',
    );
    expect(conversationRepo.update).not.toHaveBeenCalled();
  });
});
