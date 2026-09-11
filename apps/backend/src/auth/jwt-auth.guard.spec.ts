import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
  } as unknown as ExecutionContext;

  // AuthGuard('jwt') 返回的匿名父类原型，其 canActivate 即 super.canActivate
  const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
    canActivate: (...args: unknown[]) => unknown;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeGuard(isPublic: boolean | undefined) {
    const getAllAndOverride = vi.fn().mockReturnValue(isPublic);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    const cls = {
      isActive: () => false,
      set: vi.fn(),
    } as unknown as ClsService;
    return { guard: new JwtAuthGuard(reflector, cls), getAllAndOverride };
  }

  it('isPublic 为 true 时直接放行且不委托 super', () => {
    const { guard, getAllAndOverride } = makeGuard(true);
    const superSpy = vi.spyOn(superProto, 'canActivate');
    expect(guard.canActivate(context)).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('isPublic 为 false 时委托 super.canActivate', () => {
    const { guard, getAllAndOverride } = makeGuard(false);
    const superSpy = vi
      .spyOn(superProto, 'canActivate')
      .mockReturnValue('delegated');
    expect(guard.canActivate(context)).toBe('delegated');
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    expect(superSpy).toHaveBeenCalledWith(context);
  });

  it('未声明 isPublic（undefined）时同样委托 super.canActivate', () => {
    const { guard } = makeGuard(undefined);
    const superSpy = vi.spyOn(superProto, 'canActivate').mockReturnValue(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(superSpy).toHaveBeenCalledWith(context);
  });

  it('handleRequest 把 userId 写入 CLS（CLS 激活时）', () => {
    const set = vi.fn();
    const cls = { isActive: () => true, set } as unknown as ClsService;
    const guard = new JwtAuthGuard(
      { getAllAndOverride: vi.fn() } as unknown as Reflector,
      cls,
    );
    // handleRequest 内部调 super.handleRequest（passport 父类）：mock 父原型而非自身
    const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const orig = superProto['handleRequest'];
    superProto['handleRequest'] = () => ({ userId: 'u1', jti: 'j1' });
    try {
      const result = guard.handleRequest(null, { userId: 'u1' }, null, context);
      expect(result).toEqual({ userId: 'u1', jti: 'j1' });
      expect(set).toHaveBeenCalledWith('userId', 'u1');
    } finally {
      superProto['handleRequest'] = orig;
    }
  });
});
