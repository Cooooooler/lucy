import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ConfigService } from '@nestjs/config';
import { ContextService } from './context.service.js';
import { Message, MessageRole } from './entities/message.entity.js';
import { TokenizerService } from './tokenizer.service.js';

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
    // 默认预算 floor(10*0.7)=7，两条历史(5+5=10)放不下；
    // 提限到 20 → 预算 floor(20*0.7)=14，两条历史全保留
    const svc = makeSvc({
      AI_SYSTEM_PROMPT: 'sys',
      AI_CONTEXT_TOKEN_LIMIT: 20,
    });
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
