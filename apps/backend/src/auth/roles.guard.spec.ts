import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UserRole } from '../users/user.entity.js';
import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  const reflectorMock = { getAllAndOverride: vi.fn() };
  const guard = new RolesGuard(reflectorMock as unknown as Reflector);

  const context = (user?: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => vi.clearAllMocks());

  it('未标注 @Roles 的路由直接放行', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(context(undefined))).toBe(true);
  });

  it('@Roles 为空数组时放行', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(context(undefined))).toBe(true);
  });

  it('角色匹配时放行', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    expect(guard.canActivate(context({ role: UserRole.Admin }))).toBe(true);
  });

  it('角色不匹配时抛 ForbiddenException', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    expect(() => guard.canActivate(context({ role: UserRole.User }))).toThrow(
      ForbiddenException,
    );
  });

  it('request.user 缺失时 fail-closed 抛 ForbiddenException', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.Admin]);
    expect(() => guard.canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
