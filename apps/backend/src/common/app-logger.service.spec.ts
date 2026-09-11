import { ClsService } from 'nestjs-cls';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { AppLogger } from './app-logger.service.js';

/**
 * 各日志级别用独立的 mock 承接，并一并返回：
 * 断言时直接引用这些独立函数，避免 `expect(pino.log)` 这类方法引用触发
 * @typescript-eslint/unbound-method。
 */
function makeLogger(userId: string | null, active = true) {
  const cls = {
    isActive: () => active,
    get: vi.fn().mockReturnValue(userId),
  } as unknown as ClsService;
  const calls = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  };
  const pinoLogger = { ...calls } as unknown as Logger;
  return { appLogger: new AppLogger(cls, pinoLogger), ...calls };
}

describe('AppLogger', () => {
  it('log 补齐 CLS 中的 userId，并把 context 作为独立参数交给 pino', () => {
    const { appLogger, log } = makeLogger('u1');
    appLogger.log('kb create', 'KnowledgeService');
    expect(log).toHaveBeenCalledWith('kb create user=u1', 'KnowledgeService');
  });

  it('CLS 未激活时退化为 user=-', () => {
    const { appLogger, log } = makeLogger(null, false);
    appLogger.log('hello');
    expect(log).toHaveBeenCalledWith('hello user=-', undefined);
  });

  it('warn 走 pino warn 并带 userId', () => {
    const { appLogger, warn } = makeLogger('u2');
    appLogger.warn('login failed');
    expect(warn).toHaveBeenCalledWith('login failed user=u2', undefined);
  });

  it('error 透传 trace 与 context', () => {
    const { appLogger, error } = makeLogger('u3');
    appLogger.error('boom', 'stack-trace', 'Svc');
    expect(error).toHaveBeenCalledWith('boom user=u3', 'stack-trace', 'Svc');
  });

  it('error 无 trace 时不传多余的 undefined 参数', () => {
    const { appLogger, error } = makeLogger('u3');
    appLogger.error('boom', undefined, 'Svc');
    expect(error).toHaveBeenCalledWith('boom user=u3', 'Svc');
  });

  it('debug / verbose 映射到 pino 同名方法', () => {
    const { appLogger, debug, verbose } = makeLogger('u4');
    appLogger.debug('d');
    appLogger.verbose('v');
    expect(debug).toHaveBeenCalledWith('d user=u4', undefined);
    expect(verbose).toHaveBeenCalledWith('v user=u4', undefined);
  });
});
