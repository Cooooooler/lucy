/** 后端统一响应包裹结构，前后端共享 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

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
