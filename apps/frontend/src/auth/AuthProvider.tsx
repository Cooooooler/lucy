import { useLocalStorageState } from 'ahooks';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { refreshTokens } from '../api/client';
import { router } from '../router';
import type { PersistedSession } from '../stores/auth';
import { authStore, registerSessionExpired } from '../stores/auth';

const SESSION_KEY = 'lucy.auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  // ahooks 持久化：仅存 refreshToken + user，accessToken 留在内存
  const [session, setSession] = useLocalStorageState<PersistedSession>(
    SESSION_KEY,
    { defaultValue: { refreshToken: null, user: null } },
  );

  const initialSessionRef = useRef(session);
  const setSessionRef = useRef(setSession);

  useEffect(() => {
    registerSessionExpired(() => {
      void router.navigate({ to: '/login' });
    });

    // 订阅内存 store：refreshToken/user 变更时经 ahooks 持久化，accessToken 不落盘
    const unsubscribe = authStore.subscribe(() => {
      const { refreshToken, user } = authStore.get();
      setSessionRef.current({ refreshToken, user });
    });

    // 用持久化会话水合内存 store，并静默换取 accessToken
    const persisted = initialSessionRef.current;
    if (persisted.refreshToken) {
      authStore.setState(() => ({
        user: persisted.user,
        accessToken: null,
        refreshToken: persisted.refreshToken,
      }));
      void refreshTokens().catch(() => {
        // 刷新失败已由 handleSessionExpired 处理（清会话 + 跳登录）
      });
    }

    return () => {
      unsubscribe.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
