import {
  BaseUrlGuardError,
  BaseUrlPrivateAddressError,
  BaseUrlRedirectError,
} from '@/common/base-url-blocked.error.js';
import {
  createGuardedFetch,
  type GuardedFetch,
} from '@/common/guarded-fetch.js';
import { blockedErrorMessage } from '@/common/provider-error.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());
// 只影响域名解析；本文件的其它用例都用 IP 字面量，不会走到 lookup
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

/** 本地 Ollama / tokenizer 的策略：允许私网/回环（本文件的服务就跑在 127.0.0.1） */
const permissive = { allowPrivateHosts: true };
/** 云端 vendor 的策略：只许公网 */
const strict = { allowPrivateHosts: false };

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
    guard = createGuardedFetch({ policy: permissive });
  });

  afterAll(async () => {
    await guard.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('真实 302 不跟随：只命中一次本地服务，抛 BaseUrlRedirectError', async () => {
    requests = 0;
    await expect(guard.fetch(baseUrl)).rejects.toThrow(BaseUrlRedirectError);
    expect(requests).toBe(1);
  });

  it('域名解析到受限地址时，真实 undici 路径拒绝（防 DNS rebinding）', async () => {
    requests = 0;
    lookupMock.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    const error = await guard
      .fetch('http://attacker.example/')
      .catch((caught: unknown) => caught);

    // undici 会把 lookup 错误包成 `TypeError: fetch failed`，守卫错误留在 cause 链上
    expect(blockedErrorMessage(error)).toContain('受限地址');
    expect(requests).toBe(0);
  });

  it('仅公网策略下，回环字面量在发出请求前就被拒绝', async () => {
    const publicOnly = createGuardedFetch({ policy: strict });
    requests = 0;
    try {
      const error = await publicOnly
        .fetch(baseUrl)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BaseUrlPrivateAddressError);
      expect(requests).toBe(0);
    } finally {
      await publicOnly.destroy();
    }
  });

  it('真实 fetch 的守卫拒绝保留领域错误，可提取可读文案', async () => {
    const error = await guard
      .fetch('http://169.254.169.254/latest/meta-data')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BaseUrlGuardError);
    expect(blockedErrorMessage(error)).toBe(
      'API Base URL 指向受限地址（链路本地/云元数据），请检查主机',
    );
  });
});
