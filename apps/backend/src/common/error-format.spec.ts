import pino from 'pino';
import { toLoggableError } from './error-format.js';

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

  // 关键边界：pino 默认 serializers.err 会把普通对象当 Error 重新序列化，
  // type 变成 constructor.name（'Object'），按 err.type 聚合就失效了
  it('交给真实 pino 后 err.type 仍是真实类名', () => {
    let output = '';
    const logger = pino(
      {},
      {
        write(chunk: string) {
          output += chunk;
        },
      },
    );

    logger.warn(
      { err: toLoggableError(new RangeError('outer')) },
      'model test failed',
    );

    const parsed = JSON.parse(output) as {
      err: { type: string; message: string };
    };
    expect(parsed.err.type).toBe('RangeError');
    expect(parsed.err.message).toBe('outer');
  });
});
