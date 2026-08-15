import { http } from './client';
import type { LoginRequest, LoginResult, RegisterRequest, User } from './types';

// 登录/注册是匿名接口，失败的 401 不应触发令牌刷新（无凭证可换），故标记 skipAuthRefresh
export function loginApi(input: LoginRequest) {
  return http
    .post<LoginResult>('auth/login', input, {
      extra: { skipAuthRefresh: true },
    })
    .json();
}

export function registerApi(input: RegisterRequest) {
  return http
    .post<User>('auth/register', input, { extra: { skipAuthRefresh: true } })
    .json();
}

export function logoutApi() {
  return http.post<{ success: boolean }>('auth/logout').json();
}

export function meApi() {
  return http.get<components['schemas']['User']>('auth/me').json();
}
