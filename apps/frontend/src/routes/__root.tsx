import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { AuthRouterContext } from '../auth-context';

const RootComponent = () => {
  return (
    <>
      <Outlet />
      {/*{import.meta.env.DEV && <TanStackRouterDevtools />}*/}
    </>
  );
};

export const Route = createRootRouteWithContext<{
  auth: AuthRouterContext;
}>()({
  component: RootComponent,
});
