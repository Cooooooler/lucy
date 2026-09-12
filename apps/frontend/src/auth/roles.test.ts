import type { User } from '@/api/types';
import { hasMinRole } from '@/auth/roles';
import { describe, expect, it } from 'vitest';

describe('hasMinRole', () => {
  it.each([
    ['admin', true],
    ['superadmin', true],
    ['user', false],
  ])('role=%s 时 admin 门禁为 %s', (role, expected) => {
    expect(hasMinRole(role as User['role'], 'admin')).toBe(expected);
  });

  it('未知角色与缺失角色 fail-closed', () => {
    expect(hasMinRole('ghost' as User['role'], 'admin')).toBe(false);
    expect(hasMinRole(undefined, 'admin')).toBe(false);
  });
});
