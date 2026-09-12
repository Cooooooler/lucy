import type {
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  User,
} from '@/api/types';
import {
  deleteUserApi,
  getUserApi,
  listUsersApi,
  updateUserRoleApi,
  updateUserStatusApi,
  type UserListQuery,
} from '@/api/users';
import type { PageResult } from '@lucy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** 用户管理查询 key 工厂，统一管理 queryKey 生成逻辑 */
export const userKeys = {
  all: ['users'] as const,
  /** 列表失效前缀：命中全部的分用户列表查询 */
  listAll: () => [...userKeys.all, 'list'] as const,
  /** 列表查询（含分页与过滤参数） */
  list: (query: UserListQuery = {}) => [...userKeys.listAll(), query] as const,
  /** 用户详情 */
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
};

export function useUserList(query: UserListQuery = {}) {
  return useQuery<PageResult<User>>({
    queryKey: userKeys.list(query),
    queryFn: () => listUsersApi(query),
    placeholderData: (prev) => prev,
    // 用户列表低频变更：30 秒内切路由复用缓存，不重新请求；增删改经 invalidate 立即刷新
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useUserDetail(id: string | undefined) {
  return useQuery<User>({
    queryKey: userKeys.detail(id ?? ''),
    queryFn: () => getUserApi(id!),
    enabled: !!id,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { id: string; input: UpdateUserStatusRequest }) =>
      updateUserStatusApi(variables),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userKeys.listAll() });
    },
  });
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { id: string; input: UpdateUserRoleRequest }) =>
      updateUserRoleApi(variables),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: userKeys.listAll() });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUserApi(id),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: userKeys.detail(id) });
      await queryClient.invalidateQueries({ queryKey: userKeys.listAll() });
    },
  });
}
