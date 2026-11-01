import { ErrorCode, type ErrorCodeValue } from '@lucy/shared';
import { isInfrastructureError } from '../common/db-error.js';
import {
  GENERATE_ERROR_MESSAGES,
  MODEL_CREDENTIAL_MESSAGES,
  PROVIDER_ERROR_MESSAGES,
} from '../common/messages.js';
import {
  blockedErrorMessage,
  providerErrorKind,
} from '../common/provider-error.js';
import { ModelCredentialError } from '../model-provider/model-credential.error.js';

/** 失败发生时是否已经在读模型流：只有流内才可能在等模型输出。 */
export type ErrorPhase = 'stream' | 'run';

/**
 * 区分流式失败类型：客户端中止（signal.reason）> 凭证 > 基础设施（DB/事务）> 模型超时 > 其他。
 *
 * phase 决定是否启用模型超时启发式：外层 catch 只可能兜 prepareRun/落库失败（run），
 * 那里没有模型流，ETIMEDOUT 之类来自数据库连接层，套用超时启发式只会把「数据库连不上」
 * 误报成「模型调用超时」；buildChat/buildMessages 失败同样发生在拿到模型流之前。
 */
export function classifyStreamError(
  error: unknown,
  signal: AbortSignal,
  phase: ErrorPhase,
): { code: ErrorCodeValue; message: string } {
  if (signal.aborted) {
    const reason = signal.reason as Error;
    if (
      reason instanceof Error &&
      /timeout|timed out|ETIMEDOUT/i.test(reason.message)
    ) {
      return {
        code: ErrorCode.AI_GENERATE_TIMEOUT,
        message: GENERATE_ERROR_MESSAGES.timeout,
      };
    }
    return {
      code: ErrorCode.AI_GENERATE_ABORTED,
      message: GENERATE_ERROR_MESSAGES.aborted,
    };
  }
  // 凭证错误：单独码 + 可执行提示（文案单源在 common/messages.ts，前端按未知码回退
  // 服务端 message，不进入 SSE_ERROR_TEXT 的按码覆盖表）
  if (error instanceof ModelCredentialError) {
    return {
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: MODEL_CREDENTIAL_MESSAGES[error.reason],
    };
  }
  // Base URL 守卫（DNS 指向受限地址/拒绝跟随重定向）在传输层抛出的领域错误：
  // 使用独立码并透传可执行文案；该码不进前端 SSE_ERROR_TEXT 映射表
  // （文案动态），前端按未知码回退服务端 message。
  const blocked = blockedErrorMessage(error);
  if (blocked) {
    return { code: ErrorCode.AI_BASE_URL_BLOCKED, message: blocked };
  }
  // 对话链路也按供应商状态归因：401/403 与凭证无效同码，前端按服务端 message 展示
  // 可执行提示（该码不进 SSE_ERROR_TEXT 覆盖表）。429/5xx 暂沿用「生成失败」码——
  // 前端会按码覆盖文案，细分错误码需要改共享契约，列为跟进项。
  if (providerErrorKind(error) === 'unauthorized') {
    return {
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: PROVIDER_ERROR_MESSAGES.unauthorized,
    };
  }
  // 基础设施错误（DB/事务）先于模型超时启发式：Postgres 语句超时
  // 「canceling statement due to statement timeout」含 timeout 字样，落在正则
  // （model-timeout 分支）之后会误报「模型调用超时」——DB 超时/连接错误按生成失败报
  if (isInfrastructureError(error)) {
    return {
      code: ErrorCode.AI_GENERATE_FAILED,
      message: GENERATE_ERROR_MESSAGES.failed,
    };
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (
    phase === 'stream' &&
    /timeout|timed out|ETIMEDOUT/i.test(`${name} ${message}`)
  ) {
    return {
      code: ErrorCode.AI_GENERATE_TIMEOUT,
      message: GENERATE_ERROR_MESSAGES.timeout,
    };
  }
  return {
    code: ErrorCode.AI_GENERATE_FAILED,
    message: GENERATE_ERROR_MESSAGES.failed,
  };
}
