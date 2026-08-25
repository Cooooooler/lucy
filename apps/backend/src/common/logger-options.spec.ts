import { afterEach, describe, expect, it } from 'vitest';
import { genReqId, loggerModuleOptions } from './logger-options.js';

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

function mockReq(headers?: Record<string, string>) {
  return { headers: headers ?? {} };
}

function pinoHttpOf() {
  return loggerModuleOptions().pinoHttp as {
    stream?: unknown;
    transport?: unknown;
    level?: string;
    genReqId?: unknown;
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('loggerModuleOptions', () => {
  it('开发环境（非 production）通过 multistream 输出，不再使用单 transport', () => {
    setEnv({ NODE_ENV: 'development', LOG_PRETTY: undefined });
    const pinoHttp = pinoHttpOf();
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('LOG_PRETTY=1 即使在 production 也走 multistream（非单 transport）', () => {
    setEnv({ NODE_ENV: 'production', LOG_PRETTY: '1' });
    const pinoHttp = pinoHttpOf();
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('production 且未设 LOG_PRETTY 时仍走 stream（纯 JSON 输出）', () => {
    setEnv({ NODE_ENV: 'production', LOG_PRETTY: undefined });
    const pinoHttp = pinoHttpOf();
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('LOG_LEVEL 生效，默认 info', () => {
    setEnv({ LOG_LEVEL: 'debug' });
    expect(pinoHttpOf().level).toBe('debug');
    setEnv({ LOG_LEVEL: undefined });
    expect(pinoHttpOf().level).toBe('info');
  });

  it('genReqId 透传请求头 x-request-id 并回写响应头', () => {
    const res = mockRes();
    const id = genReqId(mockReq({ 'x-request-id': 'trace-abc' }), res);
    expect(id).toBe('trace-abc');
    expect(res.headers.get('x-request-id')).toBe('trace-abc');
  });

  it('genReqId 透传 x-trace-id 并回写响应头（traceId 链路追踪）', () => {
    const res = mockRes();
    const id = genReqId(mockReq({ 'x-trace-id': 'trace-xyz' }), res);
    expect(id).toBe('trace-xyz');
    expect(res.headers.get('x-request-id')).toBe('trace-xyz');
  });

  it('genReqId 无请求头时生成 UUID 并回写响应头', () => {
    const res = mockRes();
    const id = genReqId(mockReq(), res);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers.get('x-request-id')).toBe(id);
  });

  it('genReqId 空白请求头视为缺失并生成 UUID', () => {
    const res = mockRes();
    const id = genReqId(mockReq({ 'x-request-id': '   ' }), res);
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
