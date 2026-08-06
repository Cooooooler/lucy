import { createRouter } from '@tanstack/react-router';
import { authRouterContext } from './auth-context';
import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  context: { auth: authRouterContext },
});

declare module '@tanstack/react-router' {
  // eslint-disable-next-line no-unused-vars -- 模块增强接口，供全局类型推断使用
  interface Register {
    router: typeof router;
  }
}
