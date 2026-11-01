import { QueryFailedError } from 'typeorm';
import { isInfrastructureError } from './db-error.js';

describe('isInfrastructureError', () => {
  it('QueryFailedError 一律视为基础设施错误', () => {
    const error = new QueryFailedError('SELECT 1', [], new Error('syntax'));
    expect(isInfrastructureError(error)).toBe(true);
  });

  it('连接/停机/资源不足/取消类 SQLSTATE 命中', () => {
    for (const code of [
      '08006',
      '57P01',
      '57P02',
      '57P03',
      '57P04',
      '53300',
      '57014',
    ]) {
      expect(
        isInfrastructureError(Object.assign(new Error('msg'), { code })),
      ).toBe(true);
    }
  });

  it('客户端网络码与业务码不算基础设施错误（避免把模型侧超时吞掉）', () => {
    for (const code of ['ETIMEDOUT', 'ECONNREFUSED', '23505']) {
      expect(
        isInfrastructureError(Object.assign(new Error('msg'), { code })),
      ).toBe(false);
    }
  });

  it('pg-pool 裸 Error 按文案兜底', () => {
    expect(
      isInfrastructureError(
        new Error('timeout exceeded when trying to connect'),
      ),
    ).toBe(true);
    expect(
      isInfrastructureError(new Error('client has already been released')),
    ).toBe(true);
    expect(isInfrastructureError(new Error('boom'))).toBe(false);
  });

  it('非 Error 返回 false', () => {
    expect(isInfrastructureError('oops')).toBe(false);
    expect(isInfrastructureError(undefined)).toBe(false);
  });
});
