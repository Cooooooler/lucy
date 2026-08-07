import { createStore } from '@tanstack/store';
import type { User } from '../api/types';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
}

export interface PersistedSession {
  refreshToken: string | null;
  user: User | null;
}

// 仅存内存：accessToken 不落盘，刷新后为空，靠 refreshToken 静默换取
export const authStore = createStore<AuthState>({
  user: null,
  accessToken: null,
  refreshToken: null,
});

// 派生状态：refreshToken 是持久化凭证，代表完整登录会话
export const isLoggedInStore = createStore(
  () => authStore.get().refreshToken !== null,
);

// —— 会话过期回调：由 AuthProvider 注册，跳转登录页 ——
let sessionExpiredHandler: () => void = () => {};
export function registerSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

export function login(user: User, accessToken: string, refreshToken: string) {
  authStore.setState(() => ({ user, accessToken, refreshToken }));
}

// 刷新令牌轮换后写入新凭证（refreshToken 每次刷新都会变更）
export function applyTokens(accessToken: string, refreshToken: string) {
  const { user } = authStore.get();
  authStore.setState(() => ({ user, accessToken, refreshToken }));
}

export function logout() {
  authStore.setState(() => ({
    user: null,
    accessToken: null,
    refreshToken: null,
  }));
}

// 刷新失败 → 清空本地会话并通知跳转
export function handleSessionExpired() {
  logout();
  sessionExpiredHandler();
}
