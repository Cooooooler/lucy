import { http, publicHttp } from './client';
import type { LoginRequest, LoginResult, RegisterRequest, User } from './types';

export function loginApi(input: LoginRequest) {
  return publicHttp.post('auth/login', { json: input }).json<LoginResult>();
}

export function registerApi(input: RegisterRequest) {
  return publicHttp.post('auth/register', { json: input }).json<User>();
}

export function logoutApi() {
  return http.post('auth/logout').json<{ success: boolean }>();
}
