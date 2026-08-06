import { isLoggedInStore } from './stores/auth';

export interface AuthRouterContext {
  isAuthenticated: boolean;
}

// getter 形式：beforeLoad 每次导航时读取最新登录态
export const authRouterContext: AuthRouterContext = {
  get isAuthenticated() {
    return isLoggedInStore.get();
  },
};
