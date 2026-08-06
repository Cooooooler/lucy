import { beforeEach, describe, expect, it } from 'vitest';
import { authRouterContext } from './auth-context';
import { login, logout } from './stores/auth';
import { makeUser } from './test/fixtures';

const user = makeUser();

describe('authRouterContext', () => {
  beforeEach(() => {
    logout();
  });

  it('未登录时 isAuthenticated 为 false', () => {
    expect(authRouterContext.isAuthenticated).toBe(false);
  });

  it('登录后 isAuthenticated 为 true', () => {
    login(user, 'at', 'rt');
    expect(authRouterContext.isAuthenticated).toBe(true);
  });

  it('登出后恢复 false', () => {
    login(user, 'at', 'rt');
    logout();
    expect(authRouterContext.isAuthenticated).toBe(false);
  });
});
