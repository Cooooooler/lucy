import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient 默认配置。
 *
 * 缓存已整体关闭（准备重构缓存这一块）：`staleTime: 0` 让数据始终视为过期，
 * `gcTime: 0` 让查询在没人观察时立刻回收，因此每次挂载都会重新请求、不保留旧数据。
 * - queries.retry=1：网络抖动重试一次，避免瞬时失败直接报错
 * - refetchOnWindowFocus=false：切回窗口不强制刷新，避免打扰
 * - mutations.retry=false：写操作不自动重试，防止重复提交（如注册/发送）
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
