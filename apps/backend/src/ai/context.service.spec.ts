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
      AI_CONTEXT_TOKEN_LIMIT: 100,
      AI_CONTEXT_SAFETY_MARGIN: 0,
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
    // 预算 = 30 − 0 = 30，扣系统提示 5 + 新消息 5 → historyBudget=20，
    // 两条历史(5+5=10)在预算内全保留
    const svc = makeSvc({
      AI_SYSTEM_PROMPT: 'sys',
      AI_CONTEXT_TOKEN_LIMIT: 30,
    });
    const history = [msg(MessageRole.User, 'u1'), msg(MessageRole.Ai, 'a1')];
    const out = await svc.buildMessages(history, 'new', 'qwen');
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(out[1]).toBeInstanceOf(HumanMessage);
    expect(out[2]).toBeInstanceOf(AIMessage);
    expect(out[3]).toBeInstanceOf(HumanMessage);
    expect(out[3].content).toBe('new');
  });

  it('超预算时保留最近消息，丢弃更早', async () => {
    // 预算 15 − 0 = 15，扣新消息 5 → historyBudget=10；
    // recent(5) 放得下，early(5) 与之一并放入也满足 <=10，故两条保留
    const svc = makeSvc({ AI_CONTEXT_TOKEN_LIMIT: 15 });
    const history = [
      msg(MessageRole.User, 'early'),
      msg(MessageRole.Ai, 'recent'),
    ];
    const out = await svc.buildMessages(history, 'new', 'qwen');
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[0].content).toBe('early');
    expect(out[1]).toBeInstanceOf(AIMessage);
    expect(out[1].content).toBe('recent');
    expect(out[2]).toBeInstanceOf(HumanMessage);
    expect(out[2].content).toBe('new');
  });

  it('安全边际从输入预算中扣除，把放得下的历史挤掉', async () => {
    // 预算 15 − 5 = 10，扣新消息 5 → historyBudget=5，只够最近 1 条(recent 5)，
    // early(5) 放不下被丢弃——对比 margin=0 时两条都能保留
    const svc = makeSvc({
      AI_CONTEXT_TOKEN_LIMIT: 15,
      AI_CONTEXT_SAFETY_MARGIN: 5,
    });
    const history = [
      msg(MessageRole.User, 'early'),
      msg(MessageRole.Ai, 'recent'),
    ];
    const out = await svc.buildMessages(history, 'new', 'qwen');
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(AIMessage);
    expect(out[0].content).toBe('recent');
    expect(out[1]).toBeInstanceOf(HumanMessage);
  });

  it('新消息计入预算：新消息挤占预算时历史被丢弃', async () => {
    // 预算 9 − 0 = 9，扣新消息 5 → historyBudget=4，recent(5) 放不下被丢弃；
    // 若新消息未计入，historyBudget=9 本可容纳 recent
    const svc = makeSvc({ AI_CONTEXT_TOKEN_LIMIT: 9 });
    const out = await svc.buildMessages(
      [msg(MessageRole.Ai, 'recent')],
      'new',
      'qwen',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[0].content).toBe('new');
  });

  it('空历史只返回系统提示与新消息', async () => {
    const svc = makeSvc({ AI_SYSTEM_PROMPT: 'sys' });
    const out = await svc.buildMessages([], 'new', 'qwen');
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(out[1]).toBeInstanceOf(HumanMessage);
  });
});
