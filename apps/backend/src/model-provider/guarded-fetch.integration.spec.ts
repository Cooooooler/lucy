import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseUrlBlockedError } from '../common/base-url-blocked.error.js';
import { createGuardedFetch, type GuardedFetch } from './guarded-fetch.js';

/**
 * 真 undici + 本地 HTTP 服务的集成用例：上面的单测把 undici 打成 mock，
 * 只验证了「我们怎么调用它」；这里验证真实语义——`redirect: 'manual'` 确实返回 3xx
 * 且不会替我们发起第二跳（否则 mock 可以一直绿而线上照样被 302 带去元数据地址）。
 * 全程离线、确定性，不依赖外网。
 */
describe('createGuardedFetch（真实 undici + 本地 HTTP）', () => {
  let server: Server;
  let guard: GuardedFetch;
  let baseUrl = '';
  let requests = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(302, {
        location: 'http://169.254.169.254/latest/meta-data',
      });
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    guard = createGuardedFetch();
  });

  afterAll(async () => {
    await guard.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('真实 302 不跟随：只命中一次本地服务，抛 BaseUrlBlockedError', async () => {
    requests = 0;
    await expect(guard.fetch(baseUrl)).rejects.toThrow(BaseUrlBlockedError);
    expect(requests).toBe(1);
  });
});
