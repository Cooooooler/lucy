import { createRouter } from '@tanstack/react-router';
import { authRouterContext } from './auth-context';
import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  context: { auth: authRouterContext },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
