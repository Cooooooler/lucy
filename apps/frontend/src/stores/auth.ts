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

export const SESSION_KEY = 'lucy.auth';

// 同步读取持久化会话：模块加载时即水合内存 store，保证路由 beforeLoad（初始匹配阶段）
// 读到正确登录态——否则刷新页面会因 store 尚空被误判未登录，先弹 /login 再弹回 /。
function readPersistedSession(): PersistedSession {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { refreshToken: null, user: null };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { refreshToken: null, user: null };
    }
    const { refreshToken, user } = parsed as PersistedSession;
    return {
      refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
      user: user ?? null,
    };
  } catch {
    return { refreshToken: null, user: null };
  }
}

const persisted = readPersistedSession();

// 仅存内存：accessToken 不落盘，刷新后为空，靠 refreshToken 静默换取
export const authStore = createStore<AuthState>({
  user: persisted.user,
  accessToken: null,
  refreshToken: persisted.refreshToken,
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
