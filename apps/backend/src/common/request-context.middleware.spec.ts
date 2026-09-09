import { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import { RequestContextMiddleware } from './request-context.middleware.js';

describe('RequestContextMiddleware', () => {
  it('CLS 激活且无 userId 时初始化为 null', () => {
    const set = vi.fn();
    const cls = {
      isActive: () => true,
      has: () => false,
      set,
    } as unknown as ClsService;
    const next = vi.fn();
    new RequestContextMiddleware(cls).use({} as never, {} as never, next);
    expect(set).toHaveBeenCalledWith('userId', null);
    expect(next).toHaveBeenCalled();
  });

  it('CLS 未激活时直接放行', () => {
    const set = vi.fn();
    const cls = {
      isActive: () => false,
      set,
    } as unknown as ClsService;
    const next = vi.fn();
    new RequestContextMiddleware(cls).use({} as never, {} as never, next);
    expect(set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
