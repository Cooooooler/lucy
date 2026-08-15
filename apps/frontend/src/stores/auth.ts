import { createStore } from '@tanstack/store';
import type { User } from '../api/types';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
}

// 纯内存：accessToken 不落盘；user 由登录返回或 /me 拉取，也不落盘
export const authStore = createStore<AuthState>({
  user: null,
  accessToken: null,
});

// 派生状态：user 非空即视为已登录（会话恢复由 session.ts bootstrap 完成）
export const isLoggedInStore = createStore(
  () => authStore.get().user !== null,
);

// —— 会话过期回调：由 AuthProvider 注册，跳转登录页 ——
let sessionExpiredHandler: () => void = () => {};
export function registerSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

export function login(user: User) {
  authStore.setState(() => ({ user, accessToken: null }));
}

// 刷新成功写入新的短效 token（保留现有 user）
export function applyTokens(accessToken: string) {
  const { user } = authStore.get();
  authStore.setState(() => ({ user, accessToken }));
}

export function logout() {
  authStore.setState(() => ({ user: null, accessToken: null }));
}

// 刷新失败 → 清空本地会话并通知跳转
export function handleSessionExpired() {
  logout();
  sessionExpiredHandler();
}
