import { envValidationSchema } from './env-validation.schema.js';

/** 最小合法 env：仅 JWT_SECRET 必填 */
const BASE = { JWT_SECRET: 'x'.repeat(32) };

const validate = (env: Record<string, unknown>) =>
  envValidationSchema.validate(
    { ...BASE, ...env },
    { abortEarly: false, allowUnknown: true },
  ) as { error?: Error; value: Record<string, unknown> };

describe('envValidationSchema', () => {
  it('仅需 JWT_SECRET；新增可选项不设默认值，默认由消费方持有', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    // 唯一带 default 的新增项（消费方用 getOrThrow，默认值只此一处）
    expect(value.REQUEST_TIMEOUT_MS).toBe(120000);
    // 其余只校验、不设默认：缺席即 undefined，避免与消费方 fallback 形成两份默认值
    expect(value.LOG_LEVEL).toBeUndefined();
    expect(value.OLLAMA_BASE_URL).toBeUndefined();
    expect(value.BLOOM_ERROR_RATE).toBeUndefined();
    expect(value.FILE_STORAGE).toBeUndefined();
  });

  it('REQUEST_TIMEOUT_MS 允许 <=0（「禁用」语义由 TimeoutInterceptor 判定，schema 不设下限）', () => {
    for (const value of [0, -1, -1000]) {
      expect(
        validate({ REQUEST_TIMEOUT_MS: value }).error,
        `REQUEST_TIMEOUT_MS=${value} 应通过校验`,
      ).toBeUndefined();
    }
    // 非整数 / 非数值 / 超出 setTimeout 32 位上限仍失败
    expect(validate({ REQUEST_TIMEOUT_MS: 1.5 }).error).toBeDefined();
    expect(validate({ REQUEST_TIMEOUT_MS: 'abc' }).error).toBeDefined();
    expect(validate({ REQUEST_TIMEOUT_MS: 2_147_483_648 }).error).toBeDefined();
  });

  it('轮换/宽限期允许 0（0 有明确语义：每次轮换 / 无宽限期）', () => {
    expect(validate({ REFRESH_ROTATION_MS: 0 }).error).toBeUndefined();
    expect(validate({ REUSE_GRACE_SECONDS: 0 }).error).toBeUndefined();
    // 负值仍失败
    expect(validate({ REFRESH_ROTATION_MS: -1 }).error).toBeDefined();
    expect(validate({ REUSE_GRACE_SECONDS: -1 }).error).toBeDefined();
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

  it('BLOOM_ERROR_RATE 须严格介于 0 与 1（BF.RESERVE 拒绝 1，rate=1 会恒判存在）', () => {
    expect(validate({ BLOOM_ERROR_RATE: 0.01 }).error).toBeUndefined();
    expect(validate({ BLOOM_ERROR_RATE: 1 }).error).toBeDefined();
    expect(validate({ BLOOM_ERROR_RATE: 0 }).error).toBeDefined();
  });

  it('BLOOM_CAPACITY 拒绝非整数；FILE_STORAGE 仅接受 local', () => {
    expect(validate({ BLOOM_CAPACITY: 'abc' }).error).toBeDefined();
    expect(validate({ FILE_STORAGE: 'local' }).error).toBeUndefined();
    expect(validate({ FILE_STORAGE: 's3' }).error).toBeDefined();
  });
});
