import { authBootstrap } from './session';
import { isLoggedInStore } from './stores/auth';

export interface AuthRouterContext {
  ready: Promise<void>;
  isAuthenticated: boolean;
}

// ready 在模块加载时即启动会话恢复；beforeLoad 守卫 await 后再判定登录态
export const authRouterContext: AuthRouterContext = {
  ready: authBootstrap(),
  get isAuthenticated() {
    return isLoggedInStore.get();
  },
};
