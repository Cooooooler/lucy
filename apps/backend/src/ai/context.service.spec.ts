import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ConfigService } from '@nestjs/config';
import { makeModelProvider } from '../test/model-provider.fixtures.js';
import { ContextService } from './context.service.js';
import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';
import { TokenizerService } from './tokenizer.service.js';

function msg(
  role: MessageRole,
  content: string,
  status: MessageStatus = MessageStatus.Complete,
): Message {
  return { role, content, status } as Message;
}

describe('ContextService', () => {
  // 上下文较大的模型：预算由测试显式设置的 AI_CONTEXT_TOKEN_LIMIT 主导（min 取较小者）
  const provider = makeModelProvider({ contextLength: 1_000_000 });

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

  it('系统提示 + 预算内保留全部历史 + 新消息', async () => {
    // 预算 = 30 − 0 = 30，扣系统提示 5 + 新消息 5 → historyBudget=20，
    // 两条历史(5+5=10)在预算内全保留
    const svc = makeSvc({
      AI_SYSTEM_PROMPT: 'sys',
      AI_CONTEXT_TOKEN_LIMIT: 30,
    });
    const history = [msg(MessageRole.User, 'u1'), msg(MessageRole.Ai, 'a1')];
    const out = await svc.buildMessages(history, 'new', provider);
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
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[0].content).toBe('early');
    expect(out[1]).toBeInstanceOf(AIMessage);
    expect(out[1].content).toBe('recent');
    expect(out[2]).toBeInstanceOf(HumanMessage);
    expect(out[2].content).toBe('new');
  });

  it('安全边际从输入预算中扣除，把放得下的历史挤掉', async () => {
    // 预算 25 − 5 = 20，扣新消息 5 → historyBudget=15：从最近往前只装得下
    // recent-a(5) + recent-q(5) + early-a(5)，early-q 被挤掉；margin=0 时 20 恰好装下四行
    const svc = makeSvc({
      AI_CONTEXT_TOKEN_LIMIT: 25,
      AI_CONTEXT_SAFETY_MARGIN: 5,
    });
    const history = [
      msg(MessageRole.User, 'early-q'),
      msg(MessageRole.Ai, 'early-a'),
      msg(MessageRole.User, 'recent-q'),
      msg(MessageRole.Ai, 'recent-a'),
    ];
    const out = await svc.buildMessages(history, 'new', provider);
    // early-q 被预算挤掉后早轮只剩回答，首条非 system 消息不是 user，整行被修复掉
    expect(out.map((m) => m.content)).toEqual(['recent-q', 'recent-a', 'new']);
    expect(out[0]).toBeInstanceOf(HumanMessage);
  });

  it('新消息计入预算：新消息挤占预算时历史被丢弃', async () => {
    // 预算 12 − 0 = 12，扣新消息 5 → historyBudget=7：最近一条回答(5)放得下，它的提问
    // （再 5）放不下，只留下孤立回答而被规整丢弃；若新消息未计入（historyBudget=12），
    // q+a 都放得下，输出会是 q、a、new 三条——用例才有区分度
    const svc = makeSvc({ AI_CONTEXT_TOKEN_LIMIT: 12 });
    const out = await svc.buildMessages(
      [msg(MessageRole.User, 'q'), msg(MessageRole.Ai, 'a')],
      'new',
      provider,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[0].content).toBe('new');
  });

  it('小窗口模型：输出预留不超过窗口一半，仍保留历史（不静默清空）', async () => {
    // AI_OUTPUT_MAX_TOKENS=4000 但窗口仅 1000 → 预留被 clamp 到 500，
    // contextLimit = min(100000, 1000 − 500) = 500 → budget = 500，历史放得下
    const svc = makeSvc({
      AI_CONTEXT_TOKEN_LIMIT: 100000,
      AI_OUTPUT_MAX_TOKENS: 4000,
    });
    const small = makeModelProvider({ contextLength: 1000 });
    const out = await svc.buildMessages(
      [msg(MessageRole.User, 'recent-q'), msg(MessageRole.Ai, 'recent-a')],
      'new',
      small,
    );
    expect(out.map((m) => m.content)).toEqual(['recent-q', 'recent-a', 'new']);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[1]).toBeInstanceOf(AIMessage);
    expect(out[2]).toBeInstanceOf(HumanMessage);
  });

  it('空历史只返回系统提示与新消息', async () => {
    const svc = makeSvc({ AI_SYSTEM_PROMPT: 'sys' });
    const out = await svc.buildMessages([], 'new', provider);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(SystemMessage);
    expect(out[1]).toBeInstanceOf(HumanMessage);
  });

  it('空内容的历史 AI 行不进上下文（Anthropic 拒空 text block），其它状态保留半截回答', async () => {
    // saveFailure 可能把半截回答以 failed 落库、用户停止是 aborted——内容非空都可用；
    // 只有凭证失败落下的 content='' 行会被过滤，null status 的行同样放行
    const svc = makeSvc({ AI_SYSTEM_PROMPT: '' });
    const history = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Ai, '', MessageStatus.Failed),
      msg(MessageRole.Ai, 'aborted-content', MessageStatus.Aborted),
      msg(MessageRole.Ai, 'ok-answer'),
    ];
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out.map((m) => m.content)).toEqual([
      'u1',
      'aborted-content',
      'ok-answer',
      'new',
    ]);
  });

  it('尾部未被回答的孤立 user 轮被裁掉（避免相邻 Human 坏角色交替，且不重复送旧问题）', async () => {
    const svc = makeSvc({ AI_SYSTEM_PROMPT: '' });
    const history = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Ai, 'a1'),
      // 最新一轮有问无答：AI 行为空且被过滤，留下孤立 user
      msg(MessageRole.User, 'unanswered'),
      msg(MessageRole.Ai, '', MessageStatus.Failed),
    ];
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out.map((m) => m.content)).toEqual(['u1', 'a1', 'new']);
  });

  it('尾部孤立 user 先裁再算预算：不占额度，更早的完整轮次仍保留', async () => {
    // 预算 25 − 0 = 25，扣新消息 5 → historyBudget=20。若先按预算选行再裁尾，尾部孤立
    // user（40 tokens）会立刻超预算并 break，u1/a1 也被一起丢掉；先裁尾后两者完整保留
    const tokenizer = {
      countTokens: vi.fn((text: string) =>
        Promise.resolve(text === 'unanswered-huge' ? 40 : 5),
      ),
    } as unknown as TokenizerService;
    const svc = new ContextService(
      makeConfig({ AI_CONTEXT_TOKEN_LIMIT: 25 }),
      tokenizer,
    );
    const history = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Ai, 'a1'),
      msg(MessageRole.User, 'unanswered-huge'),
    ];
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out.map((m) => m.content)).toEqual(['u1', 'a1', 'new']);
  });

  it('中段的空 AI 行留下孤立 user 时修掉相邻 Human（保留更近的问题）', async () => {
    // 「凭证失败一次、重试成功」之后的历史：[u1, ai1(''), u2, ai2('ok')] 过滤后是
    // [u1, u2, ai2]，尾部不是 user 故裁尾不触发——不修的话每一轮都带着 Human、Human、
    // AI 的畸形序列（Bedrock/兼容网关直接 400）
    const svc = makeSvc({ AI_SYSTEM_PROMPT: '' });
    const history = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Ai, '', MessageStatus.Failed),
      msg(MessageRole.User, 'u2'),
      msg(MessageRole.Ai, 'a2'),
    ];
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out.map((m) => m.content)).toEqual(['u2', 'a2', 'new']);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[1]).toBeInstanceOf(AIMessage);
    expect(out[2]).toBeInstanceOf(HumanMessage);
  });

  it('首条非 system 消息必须是 user：预算裁掉提问后不留孤立 AI 行', async () => {
    // 预算 10 − 0 = 10，扣新消息 5 → historyBudget=5，只装得下最近一条（AI 回答），
    // 它的提问已被预算裁掉；首条消息是 AI 同样会被供应商拒，故整行丢弃
    const svc = makeSvc({ AI_CONTEXT_TOKEN_LIMIT: 10 });
    const history = [msg(MessageRole.User, 'u1'), msg(MessageRole.Ai, 'a1')];
    const out = await svc.buildMessages(history, 'new', provider);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect(out[0].content).toBe('new');
  });
});
