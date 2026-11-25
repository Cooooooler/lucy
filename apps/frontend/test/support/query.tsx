import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * 测试用 QueryClient：关闭重试，避免失败用例等待默认退避而超时。
 *
 * 收口此前各测试文件里逐份复制的 `new QueryClient({ defaultOptions: ... })`。
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * 以 QueryClientProvider 包裹 children 的 wrapper，供 `renderHook` 的 `wrapper` 选项使用。
 *
 * 需要注入预置缓存的用例传自己的 client，否则每次拿一个全新的测试 client。
 */
export function createQueryWrapper(client = createTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
