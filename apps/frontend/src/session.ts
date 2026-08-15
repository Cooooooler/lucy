import { meApi } from './api/auth';
import { refreshTokens } from './api/client';
import { authStore, logout } from './stores/auth';

// 模块级单飞 bootstrap：页面加载即恢复会话
// refresh(cookie→accessToken) → /me(accessToken→user)；失败视为未登录
let bootstrap: Promise<void> | null = null;
export function authBootstrap(): Promise<void> {
  bootstrap ??= (async () => {
    try {
      const tokens = await refreshTokens();
      authStore.setState(() => ({
        user: null,
        accessToken: tokens.accessToken,
      }));
      const user = await meApi();
      authStore.setState(() => ({
        user,
        accessToken: authStore.get().accessToken,
      }));
    } catch {
      // 无 cookie / 刷新失败 / /me 失败 → 静默置为未登录；跳转交给路由守卫
      logout();
    }
  })();
  return bootstrap;
}
