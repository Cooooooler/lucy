/** 后端统一响应包裹结构，前后端共享 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export const ErrorCode = {
  OK: 0,
  UNAUTHORIZED: 40101,
  INVALID_CREDENTIALS: 40102,
  ACCOUNT_DISABLED: 40103,
  USERNAME_TAKEN: 40901,
  EMAIL_TAKEN: 40902,
  INTERNAL: 50000,
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 通用分页请求参数 */
export interface PageQuery {
  page: number;
  pageSize: number;
}

/** 通用分页响应结构 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 用户公开信息（无 passwordHash 等敏感字段），前后端共享。
 * @remarks createdAt/updatedAt 在 JSON 序列化后为 ISO 8601 字符串，前端消费前需 `new Date(val)` 转换。
 */
export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string | null;
  status: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 令牌对：accessToken + refreshToken */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** 登录/刷新成功返回 */
export interface LoginResult extends AuthTokens {
  user: User;
}
