import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  // AuthGuard('jwt') 返回的匿名父类原型，其 canActivate 即 super.canActivate
  const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
    canActivate: (...args: unknown[]) => unknown;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeGuard(isPublic: boolean | undefined) {
    const getAllAndOverride = jest.fn().mockReturnValue(isPublic);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    return { guard: new JwtAuthGuard(reflector), getAllAndOverride };
  }

  it('isPublic 为 true 时直接放行且不委托 super', () => {
    const { guard, getAllAndOverride } = makeGuard(true);
    const superSpy = jest.spyOn(superProto, 'canActivate');
    expect(guard.canActivate(context)).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('isPublic 为 false 时委托 super.canActivate', () => {
    const { guard, getAllAndOverride } = makeGuard(false);
    const superSpy = jest
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
    const superSpy = jest
      .spyOn(superProto, 'canActivate')
      .mockReturnValue(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(superSpy).toHaveBeenCalledWith(context);
  });
});
