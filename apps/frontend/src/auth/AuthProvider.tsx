import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { router } from '../router';
import { registerSessionExpired } from '../stores/auth';

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  useEffect(() => {
    registerSessionExpired(() => {
      void router.navigate({ to: '/login' });
    });
  }, []);

  return <>{children}</>;
}
