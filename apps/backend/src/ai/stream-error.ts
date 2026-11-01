import { ErrorCode, type ErrorCodeValue } from '@lucy/shared';
import { isInfrastructureError } from '../common/db-error.js';
import { MODEL_CREDENTIAL_MESSAGES } from '../common/messages.js';
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
      return { code: ErrorCode.AI_GENERATE_TIMEOUT, message: '模型调用超时' };
    }
    return { code: ErrorCode.AI_GENERATE_ABORTED, message: '生成中断' };
  }
  // 凭证错误：单独码 + 可执行提示（文案单源在 common/messages.ts，前端按未知码回退
  // 服务端 message，不进入 SSE_ERROR_TEXT 的按码覆盖表）
  if (error instanceof ModelCredentialError) {
    return {
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: MODEL_CREDENTIAL_MESSAGES[error.reason],
    };
  }
  // 基础设施错误（DB/事务）先于模型超时启发式：Postgres 语句超时
  // 「canceling statement due to statement timeout」含 timeout 字样，落在正则
  // （model-timeout 分支）之后会误报「模型调用超时」——DB 超时/连接错误按生成失败报
  if (isInfrastructureError(error)) {
    return { code: ErrorCode.AI_GENERATE_FAILED, message: '生成失败' };
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (
    phase === 'stream' &&
    /timeout|timed out|ETIMEDOUT/i.test(`${name} ${message}`)
  ) {
    return { code: ErrorCode.AI_GENERATE_TIMEOUT, message: '模型调用超时' };
  }
  return { code: ErrorCode.AI_GENERATE_FAILED, message: '生成失败' };
}
