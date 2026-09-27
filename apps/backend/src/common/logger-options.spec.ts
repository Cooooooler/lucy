import { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  genReqId,
  loggerModuleOptions,
  pruneOldLogs,
  resolveLogDir,
} from './logger-options.js';

/**
 * `ConfigService.get` 在内部配置取不到键时会**回退读 process.env**；若不隔离宿主环境，
 * 「默认值」断言（level=info、默认日志目录）只在宿主未导出这些键时才成立（本机
 * `export LOG_LEVEL=debug` 即红，CI 干净所以不暴露）。测试前清空、结束后还原。
 */
const LEAKY_KEYS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'LOG_PRETTY',
  'LOG_DIR',
  'LOG_FILE_RETENTION_DAYS',
] as const;
const SAVED_ENV = Object.fromEntries(
  LEAKY_KEYS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of LEAKY_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of LEAKY_KEYS) {
    const value = SAVED_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const cfg = (env: Record<string, unknown> = {}) => new ConfigService(env);

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

function pinoHttpOf(env: Record<string, unknown> = {}) {
  return loggerModuleOptions(cfg(env)).pinoHttp as {
    stream?: unknown;
    transport?: unknown;
    level?: string;
    genReqId?: unknown;
  };
}

describe('loggerModuleOptions', () => {
  it('开发环境（非 production）通过 multistream 输出，不再使用单 transport', () => {
    const pinoHttp = pinoHttpOf({ NODE_ENV: 'development' });
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('LOG_PRETTY=1 即使在 production 也走 multistream（非单 transport）', () => {
    const pinoHttp = pinoHttpOf({ NODE_ENV: 'production', LOG_PRETTY: '1' });
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('production 且未设 LOG_PRETTY 时仍走 stream（纯 JSON 输出）', () => {
    const pinoHttp = pinoHttpOf({ NODE_ENV: 'production' });
    expect(pinoHttp.transport).toBeUndefined();
    expect(pinoHttp.stream).toBeDefined();
  });

  it('LOG_LEVEL 生效，默认 info（经 ConfigService，不再直读 process.env）', () => {
    expect(pinoHttpOf({ LOG_LEVEL: 'debug' }).level).toBe('debug');
    expect(pinoHttpOf({}).level).toBe('info');
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

  it('genReqId 空白 x-request-id 不遮盖有效 x-trace-id', () => {
    const res = mockRes();
    const id = genReqId(
      mockReq({ 'x-request-id': '   ', 'x-trace-id': 'trace-abc' }),
      res,
    );
    expect(id).toBe('trace-abc');
    expect(res.headers.get('x-request-id')).toBe('trace-abc');
  });

  it('genReqId 优先取有效 x-request-id（先于 x-trace-id）', () => {
    const res = mockRes();
    const id = genReqId(
      mockReq({ 'x-request-id': 'req-1', 'x-trace-id': 'trace-1' }),
      res,
    );
    expect(id).toBe('req-1');
  });

  it('redact 脱敏敏感路径，renameContext 为 context', () => {
    const opts = loggerModuleOptions(cfg({ NODE_ENV: 'production' }));
    expect(opts.pinoHttp).toMatchObject({
      redact: {
        censor: '[REDACTED]',
        paths: expect.arrayContaining([
          'req.headers.authorization',
          'req.headers.cookie',
          '*.accessToken',
          '*.token',
        ]) as string[],
      },
    });
    expect(opts.renameContext).toBe('context');
  });

  it('resolveLogDir 默认指向 apps/backend/logs，可用 LOG_DIR 覆盖', () => {
    expect(resolveLogDir(cfg({}))).toMatch(
      /apps.backend.logs|apps[/\\]backend[/\\]logs/,
    );
    expect(resolveLogDir(cfg({ LOG_DIR: '/tmp/custom-logs' }))).toBe(
      '/tmp/custom-logs',
    );
  });

  it('pruneOldLogs 只删除超期日志文件，保留近期与非日志文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'logs-'));
    const oldDay = new Date(Date.now() - 10 * 86400_000);
    const oldName = `backend-${oldDay.getFullYear()}-${String(oldDay.getMonth() + 1).padStart(2, '0')}-${String(oldDay.getDate()).padStart(2, '0')}.log`;
    const recentName = `backend-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}.log`;
    writeFileSync(join(dir, oldName), 'old');
    writeFileSync(join(dir, recentName), 'recent');
    writeFileSync(join(dir, 'other.txt'), 'keep');
    pruneOldLogs(dir, 7);
    expect(existsSync(join(dir, oldName))).toBe(false);
    expect(existsSync(join(dir, recentName))).toBe(true);
    expect(existsSync(join(dir, 'other.txt'))).toBe(true);
  });
});
