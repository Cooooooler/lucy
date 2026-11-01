import { beforeEach, describe, expect, it, vi } from 'vitest';

const undiciFetch = vi.hoisted(() => vi.fn());
const agentCtor = vi.hoisted(() => vi.fn());
const assertHost = vi.hoisted(() => vi.fn());
const resolveAddresses = vi.hoisted(() => vi.fn());

vi.mock('undici', () => ({
  fetch: undiciFetch,
  Agent: class {
    constructor(options: unknown) {
      agentCtor(options);
    }
  },
}));
vi.mock('./base-url-guard.js', () => ({
  assertBaseUrlHostAllowed: assertHost,
  resolveAllowedAddresses: resolveAddresses,
}));

import { BaseUrlBlockedError } from '../common/base-url-blocked.error.js';
import { createGuardedFetch } from './guarded-fetch.js';

describe('createGuardedFetch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('先做字面量校验，再以 manual redirect + 钉地址的 dispatcher 发起请求', async () => {
    undiciFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch();

    const res = await guarded('https://api.example.com/v1', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(assertHost).toHaveBeenCalledWith('https://api.example.com/v1');
    expect(undiciFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1',
      expect.objectContaining({ method: 'POST', redirect: 'manual' }),
    );
    const init = (undiciFetch.mock.calls[0] as unknown[] | undefined)?.[1] as
      { dispatcher?: unknown } | undefined;
    expect(init?.dispatcher).toBeDefined();
  });

  it('Agent 的 connect.lookup 校验后把地址钉给连接（防 DNS rebinding）', async () => {
    resolveAddresses.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    createGuardedFetch();
    const options = agentCtor.mock.calls[0]?.[0] as {
      connect: {
        lookup: (
          host: string,
          opts: Record<string, unknown>,
          cb: (...args: unknown[]) => void,
        ) => void;
      };
    };

    const cb = vi.fn();
    options.connect.lookup('api.example.com', {}, cb);

    await vi.waitFor(() => {
      expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    });
    expect(resolveAddresses).toHaveBeenCalledWith('api.example.com');
  });

  it('lookup 校验失败时用错误回调，不建立连接', async () => {
    resolveAddresses.mockRejectedValue(new BaseUrlBlockedError('blocked'));
    createGuardedFetch();
    const options = agentCtor.mock.calls[0]?.[0] as {
      connect: { lookup: (...args: unknown[]) => void };
    };

    const cb = vi.fn();
    options.connect.lookup('evil.example', {}, cb);

    await vi.waitFor(() => {
      expect(cb).toHaveBeenCalledWith(expect.any(BaseUrlBlockedError), '', 0);
    });
  });

  it('3xx 拒绝跟随重定向', async () => {
    undiciFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      }),
    );
    const guarded = createGuardedFetch();
    await expect(guarded('https://api.example.com/v1')).rejects.toThrow(
      BaseUrlBlockedError,
    );
  });

  it('支持 URL / Request 入参并取其 URL', async () => {
    undiciFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch();

    await guarded(new URL('https://a.example/x'));
    await guarded(new Request('https://b.example/y'));

    expect(assertHost).toHaveBeenNthCalledWith(1, 'https://a.example/x');
    expect(assertHost).toHaveBeenNthCalledWith(2, 'https://b.example/y');
  });
});
