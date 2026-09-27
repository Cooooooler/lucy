import { envValidationSchema } from './env-validation.schema.js';

/** 最小合法 env：仅 JWT_SECRET 必填，其余走默认 */
const BASE = { JWT_SECRET: 'x'.repeat(32) };

const validate = (env: Record<string, unknown>) =>
  envValidationSchema.validate(
    { ...BASE, ...env },
    { abortEarly: false, allowUnknown: true },
  ) as { error?: Error; value: Record<string, unknown> };

describe('envValidationSchema', () => {
  it('仅需 JWT_SECRET，其余取默认值', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect(value.REQUEST_TIMEOUT_MS).toBe(120000);
    expect(value.SHUTDOWN_GRACE_MS).toBe(15000);
    expect(value.LOG_LEVEL).toBe('info');
    expect(value.OLLAMA_BASE_URL).toBe('http://localhost:11434');
  });

  it('REQUEST_TIMEOUT_MS 允许 <=0（「禁用」语义由 TimeoutInterceptor 判定，schema 不设下限）', () => {
    for (const value of [0, -1, -1000]) {
      expect(
        validate({ REQUEST_TIMEOUT_MS: value }).error,
        `REQUEST_TIMEOUT_MS=${value} 应通过校验`,
      ).toBeUndefined();
    }
    // 非整数 / 非数值仍失败
    expect(validate({ REQUEST_TIMEOUT_MS: 1.5 }).error).toBeDefined();
    expect(validate({ REQUEST_TIMEOUT_MS: 'abc' }).error).toBeDefined();
  });

  it('LOG_LEVEL 限制为 pino 合法等级（非法值启动即失败）', () => {
    expect(validate({ LOG_LEVEL: 'debug' }).error).toBeUndefined();
    expect(validate({ LOG_LEVEL: 'verbose' }).error).toBeDefined();
  });

  it('OLLAMA_BASE_URL 必须是合法 URI', () => {
    expect(
      validate({ OLLAMA_BASE_URL: 'http://localhost:11434' }).error,
    ).toBeUndefined();
    expect(validate({ OLLAMA_BASE_URL: 'not a url' }).error).toBeDefined();
  });

  it('停机宽限期 / Bloom 容量拒绝非正整数', () => {
    expect(validate({ SHUTDOWN_GRACE_MS: 0 }).error).toBeDefined();
    expect(validate({ SHUTDOWN_GRACE_MS: -1 }).error).toBeDefined();
    expect(validate({ BLOOM_CAPACITY: 'abc' }).error).toBeDefined();
  });
});
