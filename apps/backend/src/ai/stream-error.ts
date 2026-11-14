import { ErrorCode, type ErrorCodeValue } from '@lucy/shared';
import { isInfrastructureError } from '../common/db-error.js';
import {
  GENERATE_ERROR_MESSAGES,
  MODEL_CREDENTIAL_MESSAGES,
  PROVIDER_ERROR_MESSAGES,
} from '../common/messages.js';
import {
  blockedErrorMessage,
  PROVIDER_ERROR_CODES,
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
  // 基础设施错误（DB/事务）先于供应商归类：pg 的连接失败（connect ECONNREFUSED /
  // timeout exceeded when trying to connect）与网络错误同形，先判结构化判据才不会把
  // 「数据库连不上」误报成「无法连接到 API Base URL」；Postgres 语句超时
  //（canceling statement due to statement timeout）含 timeout 字样，落在下面的
  // 模型超时启发式之后同样会误报「模型调用超时」。
  if (isInfrastructureError(error)) {
    return {
      code: ErrorCode.AI_GENERATE_FAILED,
      message: GENERATE_ERROR_MESSAGES.failed,
    };
  }
  // 对话链路与连接测试共用 providerErrorKind 的判据，码与文案收敛在
  // PROVIDER_ERROR_CODES / PROVIDER_ERROR_MESSAGES，避免两条链路归因漂移：
  // 401/403 → 凭证无效（该码不进 SSE_ERROR_TEXT，直接透传服务端 message）；
  // 404 → Base URL/协议写错；429 → 供应商限流；5xx → 供应商服务异常。
  // network 留到模型超时启发式之后再判，见下方说明。
  const providerKind = providerErrorKind(error);
  if (providerKind && providerKind !== 'network') {
    return {
      code: PROVIDER_ERROR_CODES[providerKind],
      message: PROVIDER_ERROR_MESSAGES[providerKind],
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
  // 网络类错误只在流阶段按「连不上供应商」提示：run 阶段的同类文案也可能来自数据库/
  // 启动依赖（已由上面 isInfrastructureError 判掉一部分），沿用「生成失败」兜底更稳。
  if (providerKind === 'network' && phase === 'stream') {
    return {
      code: PROVIDER_ERROR_CODES.network,
      message: PROVIDER_ERROR_MESSAGES.network,
    };
  }
  return {
    code: ErrorCode.AI_GENERATE_FAILED,
    message: GENERATE_ERROR_MESSAGES.failed,
  };
}
