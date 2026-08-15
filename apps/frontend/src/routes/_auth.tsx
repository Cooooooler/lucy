import { RippleDistortion } from '@/backgrounds/index.ts';
import FoldText from '@/components/bits/fold-text.tsx';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready;
    if (context.auth.isAuthenticated) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <RippleDistortion src="/public/auth_background.avif">
      <div className={'h-full w-full overflow-y-auto'}>
        <div
          className={
            'flex min-h-full w-full items-center justify-center gap-8 p-4 py-8 sm:p-6 lg:py-10 xl:gap-16'
          }
        >
          <div className={'hidden max-w-2xl shrink-0 xl:block'}>
            <FoldText text="Hello,Lucy!" />
            <FoldText text="Create everything" />
          </div>
          <Outlet />
        </div>
      </div>
    </RippleDistortion>
  );
}
