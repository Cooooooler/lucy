import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient 默认配置：
 * - queries.retry=1：网络抖动重试一次，避免瞬时失败直接报错
 * - staleTime=60s：60 秒内复用缓存减少重复请求（会话级查询在 use-ai 单独覆盖为 staleTime:0 保证实时）
 * - refetchOnWindowFocus=false：切回窗口不强制刷新，避免打扰
 * - mutations.retry=false：写操作不自动重试，防止重复提交（如注册/发送）
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
