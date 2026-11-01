import { ErrorCode } from '@lucy/shared';
import { QueryFailedError } from 'typeorm';
import { ModelCredentialError } from '../model-provider/model-credential.error.js';
import { classifyStreamError } from './stream-error.js';

// 未中止的 signal：绝大多数用例验证的是错误本身，不该被 signal.aborted 分支短路
const live = new AbortController().signal;

function abortedSignal(reason?: string): AbortSignal {
  const controller = new AbortController();
  if (reason) controller.abort(new Error(reason));
  else controller.abort();
  return controller.signal;
}

describe('classifyStreamError', () => {
  it('signal 中止：reason 含 timeout 归模型超时，否则归生成中断', () => {
    expect(
      classifyStreamError(
        new Error('x'),
        abortedSignal('request timed out'),
        'stream',
      ),
    ).toEqual({
      code: ErrorCode.AI_GENERATE_TIMEOUT,
      message: '模型调用超时',
    });
    expect(
      classifyStreamError(new Error('x'), abortedSignal(), 'stream'),
    ).toEqual({
      code: ErrorCode.AI_GENERATE_ABORTED,
      message: '生成中断',
    });
  });

  it('凭证错误：按 reason 给可执行提示（corrupt 与密钥轮换区分）', () => {
    expect(
      classifyStreamError(
        new ModelCredentialError('decrypt-failed', 'boom'),
        live,
        'stream',
      ),
    ).toEqual({
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: '平台密钥已变更，请重新保存 API Key',
    });
    expect(
      classifyStreamError(
        new ModelCredentialError('corrupt', 'boom'),
        live,
        'stream',
      ),
    ).toEqual({
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: 'API Key 密文损坏，请重新保存',
    });
  });

  it('供应商 401/403 归凭证无效码（与连接测试同源，可执行提示）', () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), {
      status: 401,
    });
    expect(classifyStreamError(unauthorized, live, 'stream')).toEqual({
      code: ErrorCode.AI_CREDENTIAL_INVALID,
      message: 'API Key 无效或无权限',
    });
  });

  it('QueryFailedError / SQLSTATE / 连接池文案都归为基础设施错误', () => {
    const qfe = new QueryFailedError(
      'SELECT 1',
      [],
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
      }),
    );
    expect(classifyStreamError(qfe, live, 'stream')).toEqual({
      code: ErrorCode.AI_GENERATE_FAILED,
      message: '生成失败',
    });
    const bareSqlState = Object.assign(
      new Error('canceling statement due to statement timeout'),
      { code: '57P01' },
    );
    expect(classifyStreamError(bareSqlState, live, 'stream').code).toBe(
      ErrorCode.AI_GENERATE_FAILED,
    );
    expect(
      classifyStreamError(
        new Error('timeout exceeded when trying to connect'),
        live,
        'stream',
      ).code,
    ).toBe(ErrorCode.AI_GENERATE_FAILED);
  });

  it('阶段决定超时启发式：stream 阶段 ETIMEDOUT 归模型超时，run 阶段归生成失败', () => {
    const timeout = Object.assign(
      new Error('connect ETIMEDOUT 10.0.0.5:5432'),
      { code: 'ETIMEDOUT' },
    );
    expect(classifyStreamError(timeout, live, 'stream')).toEqual({
      code: ErrorCode.AI_GENERATE_TIMEOUT,
      message: '模型调用超时',
    });
    expect(classifyStreamError(timeout, live, 'run')).toEqual({
      code: ErrorCode.AI_GENERATE_FAILED,
      message: '生成失败',
    });
  });
});
