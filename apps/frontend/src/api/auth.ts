import type { LoginResult, User } from '@lucy/shared';
import { http, publicHttp } from './client';

export function loginApi(account: string, password: string) {
  return publicHttp
    .post('auth/login', { json: { account, password } })
    .json<LoginResult>();
}

export function registerApi(input: {
  username: string;
  email: string;
  password: string;
}) {
  return publicHttp.post('auth/register', { json: input }).json<User>();
}

export function logoutApi() {
  return http.post('auth/logout').json<{ success: boolean }>();
}
