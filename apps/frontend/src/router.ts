import { createRouter } from '@tanstack/react-router';
import { authRouterContext } from './auth-context';
import { RoutePending } from './components/route-pending';
import { routeTree } from './routeTree.gen';

// 单例 Router：routeTree 由文件式路由插件自动生成（勿手改）；
// context 注入 auth，供各路由 beforeLoad 守卫 await 会话恢复后判定登录态。
//
// autoCodeSplitting 后路由组件是独立 chunk，这里补两项配套的加载策略：
// - defaultPreload: 'intent'：<Link> hover/focus 时即预取目标路由 chunk，避免点击后才开始下载
//   （'intent' 只在悬停/聚焦触发，不做视口预取，较保守）；
// - defaultPendingMs: 300 + defaultPendingComponent：首次进入大 chunk 路由时给统一加载反馈。
//   pendingMs 默认 1000ms，多数导航在 1s 内完成，等于全程无提示。
export const router = createRouter({
  routeTree,
  context: { auth: authRouterContext },
  defaultPreload: 'intent',
  defaultPendingMs: 300,
  defaultPendingComponent: RoutePending,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
