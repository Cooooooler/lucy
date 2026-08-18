import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authRouterContext } from './auth-context';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';
import { queryClient } from './queryClient';
import { router } from './router';
import { ThemeProvider } from './theme';

// Provider 嵌套：Theme（antd 主题）→ AntdApp（antd 全局 context）→ QueryClient（服务端缓存）
// → AuthProvider（注册会话过期回调）→ RouterProvider（路由守卫在 context.auth 判定登录态）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider
              router={router}
              context={{ auth: authRouterContext }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </AntdApp>
    </ThemeProvider>
  </StrictMode>,
);
