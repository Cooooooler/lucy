import {
  Message,
  MessageRole,
  MessageStatus,
} from './entities/message.entity.js';
import { normalizeTurns } from './turn-normalizer.js';

function msg(
  role: MessageRole,
  content: string,
  status: MessageStatus = MessageStatus.Complete,
): Message {
  return { role, content, status } as Message;
}

describe('normalizeTurns', () => {
  it('裁掉尾部有问无答的孤立 user 行', () => {
    const rows = [
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.Ai, 'a1'),
      msg(MessageRole.User, 'unanswered'),
    ];
    expect(normalizeTurns(rows).map((m) => m.content)).toEqual(['u1', 'a1']);
  });

  it('相邻 user 只保留更近的一条，并去掉开头的孤立 AI 行', () => {
    const rows = [
      msg(MessageRole.Ai, 'orphan-answer'),
      msg(MessageRole.User, 'u1'),
      msg(MessageRole.User, 'u2'),
      msg(MessageRole.Ai, 'a2'),
    ];
    expect(normalizeTurns(rows).map((m) => m.content)).toEqual(['u2', 'a2']);
  });

  it('幂等：对已规整的序列再次调用结果不变', () => {
    const rows = [msg(MessageRole.User, 'u1'), msg(MessageRole.Ai, 'a1')];
    expect(normalizeTurns(normalizeTurns(rows))).toEqual(normalizeTurns(rows));
  });
});
