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
  // AI 流式接口错误
  AI_CONVERSATION_NOT_FOUND: 40401,
  AI_CONVERSATION_BUSY: 40903,
  AI_GENERATE_ABORTED: 49901,
  AI_GENERATE_FAILED: 50001,
  AI_GENERATE_TIMEOUT: 50002,
  // 知识库错误
  KNOWLEDGE_NOT_FOUND: 40410,
  KNOWLEDGE_FORBIDDEN: 40301,
  KNOWLEDGE_INVALID_FILE_TYPE: 41501,
  KNOWLEDGE_FILE_TOO_LARGE: 41301,
  KNOWLEDGE_FILE_PARSE_FAILED: 42201,
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
 * AI 流式接口 SSE 事件（OpenAI 风格 `data: <json>` 帧）。
 * 帧结构：`data: {type, requestId, role?, data}\n\n`，流末尾以 `data: [DONE]` 终止。
 */
export type AiStreamEvent =
  | {
      type: 'delta';
      requestId: string;
      role: 'ai';
      data: { content?: string; thinking?: string };
    }
  | {
      type: 'error';
      requestId: string;
      data: { code: number; message: string };
    }
  | {
      type: 'done';
      requestId: string;
      role: 'ai';
      data: { finish_reason: 'stop' };
    };

// 接口契约类型由后端 Swagger spec 生成（openapi-typescript），勿手改：
// 通过 `components['schemas']['xxx']` 消费，例如登录请求/响应、用户公开信息等。
export type * from './generated/openapi.js';
