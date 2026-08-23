import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { AuthRouterContext } from '../auth-context';

export const Route = createRootRouteWithContext<{
  auth: AuthRouterContext;
}>()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <Outlet />
      {/*{import.meta.env.DEV && <TanStackRouterDevtools />}*/}
    </>
  );
}
