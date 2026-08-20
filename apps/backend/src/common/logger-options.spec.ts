import { afterEach, describe, expect, it } from 'vitest';
import { loggerModuleOptions } from './logger-options.js';

const ORIGINAL_ENV = process.env;

function setEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...overrides };
}

function mockRes() {
  const headers = new Map<string, string>();
  return {
    setHeader: (name: string, value: string) => headers.set(name, value),
    headers,
  };
}

function mockReq(header?: string) {
  return {
    headers: header
      ? { 'x-request-id': header }
      : ({} as Record<string, string>),
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('loggerModuleOptions', () => {
  it('开发环境（非 production）默认开启 pino-pretty 美化输出', () => {
    setEnv({ NODE_ENV: 'development', LOG_PRETTY: undefined });
    const { pinoHttp } = loggerModuleOptions();
    expect(pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty' },
    });
  });

  it('LOG_PRETTY=1 即使在 production 也开启美化输出', () => {
    setEnv({ NODE_ENV: 'production', LOG_PRETTY: '1' });
    const { pinoHttp } = loggerModuleOptions();
    expect(pinoHttp).toMatchObject({
      transport: { target: 'pino-pretty' },
    });
  });

  it('production 且未设 LOG_PRETTY 时输出 JSON（无 transport）', () => {
    setEnv({ NODE_ENV: 'production', LOG_PRETTY: undefined });
    const { pinoHttp } = loggerModuleOptions();
    expect((pinoHttp as { transport?: unknown }).transport).toBeUndefined();
  });

  it('LOG_LEVEL 生效，默认 info', () => {
    setEnv({ LOG_LEVEL: 'debug' });
    expect(loggerModuleOptions().pinoHttp).toMatchObject({ level: 'debug' });
    setEnv({ LOG_LEVEL: undefined });
    expect(loggerModuleOptions().pinoHttp).toMatchObject({ level: 'info' });
  });

  it('genReqId 透传请求头 x-request-id 并回写响应头', () => {
    const { pinoHttp } = loggerModuleOptions();
    const res = mockRes();
    const req = mockReq('trace-abc');
    const id = (
      pinoHttp as { genReqId: (r: unknown, s: unknown) => unknown }
    ).genReqId(req, res);
    expect(id).toBe('trace-abc');
    expect(res.headers.get('x-request-id')).toBe('trace-abc');
  });

  it('genReqId 无请求头时生成 UUID 并回写响应头', () => {
    const { pinoHttp } = loggerModuleOptions();
    const res = mockRes();
    const req = mockReq();
    const id = (
      pinoHttp as { genReqId: (r: unknown, s: unknown) => unknown }
    ).genReqId(req, res);
    expect(id).toEqual(expect.any(String));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers.get('x-request-id')).toBe(id);
  });

  it('genReqId 空白请求头视为缺失并生成 UUID', () => {
    const { pinoHttp } = loggerModuleOptions();
    const res = mockRes();
    const req = { headers: { 'x-request-id': '   ' } };
    const id = (
      pinoHttp as { genReqId: (r: unknown, s: unknown) => unknown }
    ).genReqId(req, res);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers.get('x-request-id')).toBe(id);
  });

  it('redact 脱敏敏感路径，renameContext 为 context', () => {
    setEnv({ NODE_ENV: 'production' });
    const opts = loggerModuleOptions();
    expect(opts.pinoHttp).toMatchObject({
      redact: {
        censor: '[REDACTED]',
        paths: expect.arrayContaining([
          'req.headers.authorization',
          'req.headers.cookie',
        ]) as string[],
      },
    });
    expect(opts.renameContext).toBe('context');
  });
});
