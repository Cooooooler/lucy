import { describe, expect, it, vi } from 'vitest';
import { makeUser } from './test/fixtures';

vi.mock('./api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('./api/auth', () => ({ meApi: vi.fn() }));

const user = makeUser();

// 重置模块注册表，取全新 session 模块（bootstrap=null）与全新依赖 mock fn
async function loadAuth() {
  vi.resetModules();
  const session = await import('./session');
  const { authStore } = await import('./stores/auth');
  const { refreshTokens } = await import('./api/client');
  const { meApi } = await import('./api/auth');
  authStore.setState(() => ({ user: null, accessToken: null }));
  return {
    authBootstrap: session.authBootstrap,
    authStore,
    refreshTokens,
    meApi,
  };
}

describe('authBootstrap', () => {
  it('成功后写入 accessToken 与 user', async () => {
    const { authBootstrap, authStore, refreshTokens, meApi } = await loadAuth();
    vi.mocked(refreshTokens).mockResolvedValue({ accessToken: 'at' });
    vi.mocked(meApi).mockResolvedValue(user);
    await authBootstrap();
    expect(authStore.get()).toEqual({ user, accessToken: 'at' });
  });

  it('失败时静默登出', async () => {
    const { authBootstrap, authStore, refreshTokens } = await loadAuth();
    vi.mocked(refreshTokens).mockRejectedValue(new Error('no session'));
    await authBootstrap();
    expect(refreshTokens).toHaveBeenCalled();
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
  });
});
