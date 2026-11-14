import pino from 'pino';
import { QueryFailedError } from 'typeorm';
import { serializeErrorForLog, toLoggableError } from './error-format.js';

/** 走真实 pino + 项目的 err 序列化器，断言最终写出的 JSON 字段 */
function capture(fields: Record<string, unknown>): {
  text: string;
  parsed: { err: { type: string; message: string; [k: string]: unknown } };
} {
  let text = '';
  const logger = pino(
    { serializers: { err: serializeErrorForLog } },
    {
      write(chunk: string) {
        text += chunk;
      },
    },
  );
  logger.warn(fields, 'model test failed');
  return {
    text,
    parsed: JSON.parse(text) as {
      err: { type: string; message: string; [k: string]: unknown };
    },
  };
}

describe('toLoggableError', () => {
  it('Error 原样返回（保留类名与 cause）', () => {
    const cause = new TypeError('decrypt root');
    const error = new RangeError('outer', { cause });

    const loggable = toLoggableError(error);

    expect(loggable).toBe(error);
    expect(loggable.name).toBe('RangeError');
    expect((loggable.cause as Error).name).toBe('TypeError');
  });

  it('非 Error 包成 Error，保留可读 message', () => {
    expect(toLoggableError('oops').message).toBe('oops');
    expect(toLoggableError(null).message).toBe('null');
    expect(toLoggableError({ code: 'x' }).message).toBe('{"code":"x"}');
  });
});

describe('serializeErrorForLog', () => {
  // 关键边界：pino 默认序列化器会把普通对象当 Error 重新序列化，
  // type 变成 constructor.name（'Object'），按 err.type 聚合就失效了
  it('交给真实 pino 后 err.type 仍是真实类名', () => {
    const { parsed } = capture({
      err: toLoggableError(new RangeError('outer')),
    });

    expect(parsed.err.type).toBe('RangeError');
    expect(parsed.err.message).toBe('outer');
  });

  it('cause 链保留为嵌套 type/message，仍可追根因', () => {
    const error = new Error('outer', { cause: new RangeError('root') });
    const { parsed } = capture({ err: error });

    expect(parsed.err.type).toBe('Error');
    expect(parsed.err.cause).toEqual({
      type: 'RangeError',
      message: 'root',
      stack: expect.any(String) as string,
    });
  });

  // QueryFailedError 的 query/parameters 是 pino 默认序列化器最危险的泄漏面：
  // parameters 即落库绑定值，含用户提问与模型回答全文
  it('QueryFailedError 的 SQL 与绑定参数不进入日志', () => {
    const failed = new QueryFailedError(
      'INSERT INTO "messages"("content") VALUES ($1)',
      ['用户的秘密提问'],
      Object.assign(
        new Error('duplicate key value violates unique constraint'),
        {
          code: '23505',
          detail: 'Key (conversation_id)=(c1) already exists',
        },
      ),
    );

    const { text, parsed } = capture({ err: toLoggableError(failed) });

    expect(parsed.err.type).toBe('QueryFailedError');
    expect(text).not.toContain('用户的秘密提问');
    expect(text).not.toContain('INSERT INTO');
    expect(text).not.toContain('already exists');
    expect(parsed.err).not.toHaveProperty('query');
    expect(parsed.err).not.toHaveProperty('parameters');
    expect(parsed.err).not.toHaveProperty('driverError');
  });

  it('非 Error 值原样透传（调用方应先用 toLoggableError 归一）', () => {
    expect(serializeErrorForLog('oops')).toBe('oops');
  });
});
