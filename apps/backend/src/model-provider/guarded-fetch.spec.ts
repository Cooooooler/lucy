import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assertResolved = vi.hoisted(() => vi.fn());
vi.mock('./base-url-guard.js', () => ({
  assertBaseUrlResolvedAllowed: assertResolved,
}));

import { createGuardedFetch } from './guarded-fetch.js';

describe('createGuardedFetch', () => {
  const nativeFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', nativeFetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('每次请求前校验解析后 IP，并以 manual redirect 发起请求', async () => {
    nativeFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch();

    const res = await guarded('https://api.example.com/v1', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(assertResolved).toHaveBeenCalledWith('https://api.example.com/v1');
    expect(nativeFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1',
      expect.objectContaining({ method: 'POST', redirect: 'manual' }),
    );
  });

  it('支持 URL / Request 入参并取其 URL', async () => {
    nativeFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const guarded = createGuardedFetch();

    await guarded(new URL('https://a.example/x'));
    await guarded(new Request('https://b.example/y'));

    expect(assertResolved).toHaveBeenNthCalledWith(1, 'https://a.example/x');
    expect(assertResolved).toHaveBeenNthCalledWith(2, 'https://b.example/y');
  });

  it('3xx 拒绝跟随重定向', async () => {
    nativeFetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      }),
    );
    const guarded = createGuardedFetch();
    await expect(guarded('https://api.example.com/v1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('解析结果受限时直接抛错，不发起真实请求', async () => {
    assertResolved.mockRejectedValue(
      new BadRequestException('API Base URL 指向受限地址'),
    );
    const guarded = createGuardedFetch();
    await expect(guarded('https://evil.example/')).rejects.toThrow(
      'API Base URL 指向受限地址',
    );
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
