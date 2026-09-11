import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UserRole } from '../common/roles.js';
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

  it('操作者角色未知时 fail-closed 抛 ForbiddenException', () => {
    required([UserRole.User]);
    expect(() => guard.canActivate(context({ role: 'ghost' }))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles 出现无法识别的角色时 fail-closed，即便操作者是 superadmin', () => {
    required(['administrator']);
    expect(() =>
      guard.canActivate(context({ role: UserRole.SuperAdmin })),
    ).toThrow(ForbiddenException);
  });

  it('@Roles 同时含合法与非法角色时仍 fail-closed', () => {
    required([UserRole.Admin, 'typo']);
    expect(() =>
      guard.canActivate(context({ role: UserRole.SuperAdmin })),
    ).toThrow(ForbiddenException);
  });
});
