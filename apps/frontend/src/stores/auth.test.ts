import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUser } from '../test/fixtures';
import {
  applyTokens,
  authStore,
  handleSessionExpired,
  isLoggedInStore,
  login,
  logout,
  registerSessionExpired,
} from './auth';

const user = makeUser();

describe('authStore', () => {
  beforeEach(() => {
    logout();
    registerSessionExpired(() => {});
  });

  it('初始状态为空且未登录', () => {
    expect(authStore.get()).toEqual({
      user: null,
      accessToken: null,
      refreshToken: null,
    });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('login 写入用户与令牌并标记已登录', () => {
    login(user, 'at', 'rt');
    expect(authStore.get()).toEqual({
      user,
      accessToken: 'at',
      refreshToken: 'rt',
    });
    expect(isLoggedInStore.get()).toBe(true);
  });

  it('applyTokens 轮换令牌并保留用户', () => {
    login(user, 'at-old', 'rt-old');
    applyTokens('at-new', 'rt-new');
    expect(authStore.get()).toEqual({
      user,
      accessToken: 'at-new',
      refreshToken: 'rt-new',
    });
  });

  it('logout 清空会话并恢复未登录', () => {
    login(user, 'at', 'rt');
    logout();
    expect(authStore.get()).toEqual({
      user: null,
      accessToken: null,
      refreshToken: null,
    });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('默认会话过期回调为空操作', () => {
    login(user, 'at', 'rt');
    expect(() => handleSessionExpired()).not.toThrow();
    expect(authStore.get().refreshToken).toBeNull();
  });

  it('handleSessionExpired 调用已注册回调并清空会话', () => {
    const handler = vi.fn();
    registerSessionExpired(handler);
    login(user, 'at', 'rt');
    handleSessionExpired();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(authStore.get().refreshToken).toBeNull();
  });
});
