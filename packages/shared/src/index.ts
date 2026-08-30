import type { operations } from './generated/openapi.js';

/** 后端统一响应包裹结构，前后端共享 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export const ErrorCode = {
  /** 成功响应码（ApiResponse 信封约定）：后端 ApiResponseInterceptor 统一包裹为 { code: 0, message: 'ok', data }，前端据此判定成功；非 0 视为业务错误。 */
  OK: 0,
  /** 未捕获异常兜底码：非 HttpException 的异常由 AllExceptionsFilter 输出 500 + 此码（消息「服务器内部错误」）。 */
  INTERNAL: 50000,
  // === AI 流式接口错误（SSE error 事件 data.code 载荷）===
  // 以下码均由 apps/backend/src/ai/ai.service.ts 作为 SSE error 事件产出；流内错误无法抛 HttpException，
  // 故保留细粒度码供前端区分（超时/中断/失败等）。对应 HTTP status 无意义，前端按 data.code 分支。
  /** 目标会话不存在或已被删除，流启动时校验失败即中止。消息：会话不存在。 */
  AI_CONVERSATION_NOT_FOUND: 40401,
  /** 会话正在生成中，拒绝并发请求。消息：该会话正在生成中，请稍候。 */
  AI_CONVERSATION_BUSY: 40903,
  /** 生成过程被中断（如用户停止 / 上层取消 / AbortController 触发）。消息：生成中断。 */
  AI_GENERATE_ABORTED: 49901,
  /** 模型生成失败（上游不可用、调用或解析异常等）。消息：生成失败。 */
  AI_GENERATE_FAILED: 50001,
  /** 模型调用超时。消息：模型调用超时。 */
  AI_GENERATE_TIMEOUT: 50002,
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

// 知识库/文档查询参数：从生成的 operations 派生。openapi 不为 @Query() DTO 产出组件 schema，
// 其形状只落在 operations[...].parameters.query，故在此收敛为共享类型（前后端同源、免手写漂移）。
export type KnowledgeListQuery =
  operations['KnowledgeController_list']['parameters']['query'];
export type DocumentListQuery =
  operations['KnowledgeController_listDocuments']['parameters']['query'];

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
      data: { finish_reason: 'stop' | 'length'; truncated?: boolean };
    };

// 接口契约类型由后端 Swagger spec 生成（openapi-typescript），勿手改：
// 通过 `components['schemas']['xxx']` 消费，例如登录请求/响应、用户公开信息等。
export type * from './generated/openapi.js';
