import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { router } from '../router';
import { registerSessionExpired } from '../stores/auth';

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  useEffect(() => {
    // 注册会话过期回调：刷新失败/401 重放判定过期时统一跳转登录页
    registerSessionExpired(() => {
      void router.navigate({ to: '/login' });
    });
  }, []);

  return <>{children}</>;
}
