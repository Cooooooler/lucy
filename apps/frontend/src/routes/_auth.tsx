import { RippleDistortion } from '@bg';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <RippleDistortion
      src="/public/auth_background.avif"
      brushSize={150}
      strength={0.2}
      swirl={1}
      rings={4}
      grayscale
      spread={5}
      fade={3}
      spacing={15}
      dispersion={0}
      glint={0}
      tint="#a855f7"
      tintAmount={0.1}
      highlightColor="#ffffff"
      trigger="hover"
      clickStrength={2}
      quality="low"
      enabled
    >
      <div className={'flex h-full w-full items-center justify-center'}>
        <Outlet />
      </div>
    </RippleDistortion>
  );
}
