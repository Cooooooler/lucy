import { envValidationSchema } from './env-validation.schema.js';

/** 最小合法 env：仅 JWT_SECRET 必填 */
const BASE = { JWT_SECRET: 'x'.repeat(32) };

const validate = (env: Record<string, unknown>) =>
  envValidationSchema.validate(
    { ...BASE, ...env },
    { abortEarly: false, allowUnknown: true },
  ) as { error?: Error; value: Record<string, unknown> };

describe('envValidationSchema', () => {
  it('仅需 JWT_SECRET；带 default 的项消费方用 getOrThrow，其余默认由消费方持有', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    // 消费方用 getOrThrow 的项：默认值只此一处（否则会与消费方 fallback 形成两份）
    expect(value.REQUEST_TIMEOUT_MS).toBe(120000);
    expect(value.SHUTDOWN_GRACE_MS).toBe(15000);
    expect(value.DB_STATEMENT_TIMEOUT_MS).toBe(30000);
    expect(value.DB_IDLE_TX_TIMEOUT_MS).toBe(60000);
    // 其余只校验、不设默认：缺席即 undefined，避免与消费方 fallback 形成两份默认值
    expect(value.LOG_LEVEL).toBeUndefined();
    expect(value.OLLAMA_BASE_URL).toBeUndefined();
    expect(value.BLOOM_ERROR_RATE).toBeUndefined();
    expect(value.FILE_STORAGE).toBeUndefined();
  });

  it('停机宽限期须为正；DB 上界允许 0（不限）但拒绝负值', () => {
    expect(validate({ SHUTDOWN_GRACE_MS: 5000 }).error).toBeUndefined();
    // 0 会让兜底强退立刻触发，等于没有优雅停机：启动期拦下
    expect(validate({ SHUTDOWN_GRACE_MS: 0 }).error).toBeDefined();
    expect(validate({ SHUTDOWN_GRACE_MS: -1 }).error).toBeDefined();
    // 0 是 Postgres 的「不限」语义
    expect(validate({ DB_STATEMENT_TIMEOUT_MS: 0 }).error).toBeUndefined();
    expect(validate({ DB_STATEMENT_TIMEOUT_MS: -1 }).error).toBeDefined();
    expect(validate({ DB_IDLE_TX_TIMEOUT_MS: 0 }).error).toBeUndefined();
    expect(validate({ DB_IDLE_TX_TIMEOUT_MS: -1 }).error).toBeDefined();
  });

  it('停机宽限期与 DB 上界拒绝超 int32：setTimeout 会按 1ms 处理、Postgres 在建连时报错', () => {
    expect(validate({ SHUTDOWN_GRACE_MS: 2_147_483_648 }).error).toBeDefined();
    expect(
      validate({ DB_STATEMENT_TIMEOUT_MS: 2_147_483_648 }).error,
    ).toBeDefined();
    expect(
      validate({ DB_IDLE_TX_TIMEOUT_MS: 2_147_483_648 }).error,
    ).toBeDefined();
  });

  it('REQUEST_TIMEOUT_MS 允许 0（禁用），拒绝负值/非整数/超上限', () => {
    expect(validate({ REQUEST_TIMEOUT_MS: 0 }).error).toBeUndefined();
    // 负值几乎必然是误配：启动期拒绝，而非当成「禁用」静默吞掉
    expect(validate({ REQUEST_TIMEOUT_MS: -1 }).error).toBeDefined();
    expect(validate({ REQUEST_TIMEOUT_MS: -1000 }).error).toBeDefined();
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

  it('LOG_PRETTY 接受 0/1/true/false（兼容一直可用的写法），其余拒绝', () => {
    for (const value of ['0', '1', 'true', 'false']) {
      expect(validate({ LOG_PRETTY: value }).error).toBeUndefined();
    }
    expect(validate({ LOG_PRETTY: 'yes' }).error).toBeDefined();
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

  it('非空字符串项拒绝空串（空串 != undefined，不会触发消费方的 ?? 回退）', () => {
    expect(validate({ OLLAMA_MODEL: '' }).error).toBeDefined();
    expect(validate({ OLLAMA_MODEL: 'qwen2.5:7b' }).error).toBeUndefined();
    expect(validate({ AI_TITLE_PROMPT: '' }).error).toBeDefined();
    // 系统提示允许留空（= 不注入系统提示）
    expect(validate({ AI_SYSTEM_PROMPT: '' }).error).toBeUndefined();
  });
});
