import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshTokens } from '../api/client';
import { router } from '../router';
import {
  applyTokens,
  authStore,
  handleSessionExpired,
  login,
  logout,
} from '../stores/auth';
import { makeUser } from '../test/fixtures';
import { AuthProvider } from './AuthProvider';

vi.mock('../api/client', () => ({ refreshTokens: vi.fn() }));
vi.mock('../router', () => ({ router: { navigate: vi.fn() } }));

const navigateMock = vi.mocked(router.navigate);
const refreshMock = vi.mocked(refreshTokens);

const user = makeUser();
// 经 localStorage 序列化后 Date 会变成 ISO 字符串
const serializedUser = JSON.parse(JSON.stringify(user));
const SESSION_KEY = 'lucy.auth';

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    logout();
    refreshMock.mockReset();
    refreshMock.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
  });

  it('渲染子节点且无持久化会话时不刷新', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('水合持久化会话并触发静默刷新', () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ refreshToken: 'rt', user }),
    );
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(authStore.get()).toMatchObject({
      user: serializedUser,
      accessToken: null,
      refreshToken: 'rt',
    });
  });

  it('刷新成功后轮换令牌', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ refreshToken: 'rt', user }),
    );
    refreshMock.mockImplementation(async () => {
      await Promise.resolve();
      applyTokens('at2', 'rt2');
      return { accessToken: 'at2', refreshToken: 'rt2' };
    });

    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(authStore.get().accessToken).toBe('at2');
    });
    expect(authStore.get().refreshToken).toBe('rt2');
  });

  it('会话变更时持久化 refreshToken 与 user，不持久化 accessToken', async () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );

    act(() => {
      login(user, 'at', 'rt');
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}');
      expect(stored).toEqual({ refreshToken: 'rt', user: serializedUser });
      expect(stored.accessToken).toBeUndefined();
    });
  });

  it('会话过期时跳转登录页', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );

    act(() => {
      handleSessionExpired();
    });

    expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
  });

  it('卸载后不再订阅 store 变更', async () => {
    const { unmount } = render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    unmount();

    act(() => {
      login(user, 'at', 'rt');
    });

    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}');
    expect(stored.refreshToken).not.toBe('rt');
  });
});
