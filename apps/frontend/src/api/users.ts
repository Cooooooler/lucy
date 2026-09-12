import type { PageResult, operations } from '@lucy/shared';
import { http } from './client.js';
import type {
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  User,
} from './types.js';

// 用户管理 REST 客户端：全部经 http 实例（自动附加 Bearer + 401 单飞刷新 + 信封解包）。
// 列表查询类型由共享包从生成的 UsersController_list 派生导出。
export type UserListQuery =
  operations['UsersController_list']['parameters']['query'];

export function listUsersApi(query: UserListQuery = {}) {
  return http.get<PageResult<User>>('users', query).json();
}

export function getUserApi(id: string) {
  return http.get<User>(`users/${id}`).json();
}

export function updateUserStatusApi(variables: {
  id: string;
  input: UpdateUserStatusRequest;
}) {
  return http
    .patch<User>(`users/${variables.id}/status`, variables.input)
    .json();
}

export function updateUserRoleApi(variables: {
  id: string;
  input: UpdateUserRoleRequest;
}) {
  return http.patch<User>(`users/${variables.id}/role`, variables.input).json();
}

export function deleteUserApi(id: string) {
  return http.delete<null>(`users/${id}`).json();
}
