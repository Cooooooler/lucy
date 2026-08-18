import { createRouter } from '@tanstack/react-router';
import { authRouterContext } from './auth-context';
import { routeTree } from './routeTree.gen';

// 单例 Router：routeTree 由文件式路由插件自动生成（勿手改）；
// context 注入 auth，供各路由 beforeLoad 守卫 await 会话恢复后判定登录态
export const router = createRouter({
  routeTree,
  context: { auth: authRouterContext },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
