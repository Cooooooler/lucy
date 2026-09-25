import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolveAuthFailure } from './auth-failure.js';

function throwsWith(err: Error | null | undefined): unknown {
  try {
    resolveAuthFailure(err);
  } catch (caught) {
    return caught;
  }
  throw new Error('应当抛出');
}

describe('resolveAuthFailure', () => {
  it('无 err（缺凭证）抛中文 401', () => {
    const thrown = throwsWith(null) as UnauthorizedException;
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect(thrown.message).toBe('未登录或登录已过期');
  });

  it('业务中文 401 原样透出', () => {
    const business = new UnauthorizedException('令牌已失效');
    expect(throwsWith(business)).toBe(business);
  });

  it('passport 默认英文 Unauthorized 换成中文 401', () => {
    const thrown = throwsWith(new UnauthorizedException()) as
      UnauthorizedException | Error;
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect(thrown.message).toBe('未登录或登录已过期');
  });

  it('403 等非 401 原样透出，不降级', () => {
    const forbidden = new ForbiddenException('账号不可用');
    expect(throwsWith(forbidden)).toBe(forbidden);
  });

  it('非 HttpException 原样抛出（过滤器兜底 50000 + 上下文日志）', () => {
    const boom = new Error('boom');
    expect(throwsWith(boom)).toBe(boom);
  });
});
