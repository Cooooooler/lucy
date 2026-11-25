import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 QueryClient 默认配置。
 *
 * 默认策略是「挂载即取新」：`staleTime: 0` 让数据一挂载就视为过期，`gcTime` 5 分钟让查询
 * 在没人观察时回收；列表类查询按需自行声明更长的 `staleTime`（如知识库/模型供应商列表
 * 的 3 分钟），以便返回页面时复用已加载分页。
 * - queries.retry=1：网络抖动重试一次，避免瞬时失败直接报错
 * - refetchOnWindowFocus=false：切回窗口不强制刷新，避免打扰（默认值就是 true，必须显式关）
 * - mutations.retry=false：写操作不自动重试，防止重复提交（如注册/发送）
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
