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
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('login 写入用户并标记已登录，不带令牌', () => {
    login(user);
    expect(authStore.get()).toEqual({ user, accessToken: null });
    expect(isLoggedInStore.get()).toBe(true);
  });

  it('applyTokens 写入短效 token 并保留用户', () => {
    login(user);
    applyTokens('at-new');
    expect(authStore.get()).toEqual({ user, accessToken: 'at-new' });
  });

  it('logout 清空会话并恢复未登录', () => {
    login(user);
    applyTokens('at');
    logout();
    expect(authStore.get()).toEqual({ user: null, accessToken: null });
    expect(isLoggedInStore.get()).toBe(false);
  });

  it('默认会话过期回调为空操作', () => {
    login(user);
    expect(() => handleSessionExpired()).not.toThrow();
    expect(authStore.get().accessToken).toBeNull();
  });

  it('handleSessionExpired 调用已注册回调并清空会话', () => {
    const handler = vi.fn();
    registerSessionExpired(handler);
    login(user);
    handleSessionExpired();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(authStore.get().user).toBeNull();
  });
});
