import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authRouterContext } from './auth-context';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';
import { queryClient } from './queryClient';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
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
    </ConfigProvider>
  </StrictMode>,
);
