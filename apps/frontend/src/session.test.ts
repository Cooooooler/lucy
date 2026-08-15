import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meApi } from './api/auth';
import { refreshTokens } from './api/client';
import { authStore } from './stores/auth';
import { makeUser } from './test/fixtures';
import { authBootstrap } from './session';

vi.mock('./api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('./api/auth', () => ({ meApi: vi.fn() }));

const user = makeUser();

describe('authBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authStore.setState(() => ({ user: null, accessToken: null }));
  });

  it('成功后写入 accessToken 与 user', async () => {
    vi.mocked(refreshTokens).mockResolvedValue({ accessToken: 'at' });
    vi.mocked(meApi).mockResolvedValue(user);
    await authBootstrap();
    expect(authStore.get()).toEqual({ user, accessToken: 'at' });
  });

  it('失败时静默登出', async () => {
    vi.mocked(refreshTokens).mockRejectedValue(new Error('no session'));
    await authBootstrap();
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
  });
});
