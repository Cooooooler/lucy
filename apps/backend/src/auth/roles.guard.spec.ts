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

  const required = (roles: string[]): void => {
    reflectorMock.getAllAndOverride.mockReturnValue(roles);
  };

  beforeEach(() => vi.clearAllMocks());

  it('未标注 @Roles 的路由直接放行', () => {
    required(undefined as never);
    expect(guard.canActivate(context(undefined))).toBe(true);
  });

  it('@Roles 为空数组时放行', () => {
    required([]);
    expect(guard.canActivate(context(undefined))).toBe(true);
  });

  it('角色精确匹配时放行', () => {
    required([UserRole.Admin]);
    expect(guard.canActivate(context({ role: UserRole.Admin }))).toBe(true);
  });

  it('级别更高的角色满足较低要求（superadmin 通过 @Roles(Admin)）', () => {
    required([UserRole.Admin]);
    expect(guard.canActivate(context({ role: UserRole.SuperAdmin }))).toBe(
      true,
    );
  });

  it('级别不足的角色被拒绝（admin 不满足 @Roles(SuperAdmin)）', () => {
    required([UserRole.SuperAdmin]);
    expect(() => guard.canActivate(context({ role: UserRole.Admin }))).toThrow(
      ForbiddenException,
    );
  });

  it('普通用户不满足 @Roles(Admin)', () => {
    required([UserRole.Admin]);
    expect(() => guard.canActivate(context({ role: UserRole.User }))).toThrow(
      ForbiddenException,
    );
  });

  it('request.user 缺失时 fail-closed 抛 ForbiddenException', () => {
    required([UserRole.Admin]);
    expect(() => guard.canActivate(context(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('未知角色 fail-closed 抛 ForbiddenException', () => {
    required([UserRole.User]);
    expect(() => guard.canActivate(context({ role: 'ghost' }))).toThrow(
      ForbiddenException,
    );
  });
});
