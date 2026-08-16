import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRouterContext } from './auth-context';
import { login, logout } from './stores/auth';
import { makeUser } from './test/fixtures';

vi.mock('./api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('./api/auth', () => ({ meApi: vi.fn() }));
vi.mock('./session', async () => {
  const actual = await vi.importActual<typeof import('./session')>('./session');
  return { ...actual, authBootstrap: () => Promise.resolve() };
});

const user = makeUser();

describe('authRouterContext', () => {
  beforeEach(() => {
    logout();
  });

  it('ready 为已解析的 Promise', async () => {
    await expect(authRouterContext.ready).resolves.toBeUndefined();
  });

  it('未登录时 isAuthenticated 为 false', () => {
    expect(authRouterContext.isAuthenticated).toBe(false);
  });

  it('登录后 isAuthenticated 为 true', () => {
    login(user);
    expect(authRouterContext.isAuthenticated).toBe(true);
  });
});
