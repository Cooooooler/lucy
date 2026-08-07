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

// 接口契约类型由后端 Swagger spec 生成（openapi-typescript），勿手改：
// 通过 `components['schemas']['xxx']` 消费，例如登录请求/响应、用户公开信息等。
export type * from './generated/openapi.js';
