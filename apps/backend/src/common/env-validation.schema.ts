import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DB_HOST: Joi.string().default('127.0.0.1'),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().default('postgres'),
  DB_PASSWORD: Joi.string().default('postgres'),
  DB_NAME: Joi.string().default('lucy'),
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  USER_STATUS_CACHE_TTL_SECONDS: Joi.number().default(30),
  // 本次**新增**的可选项只做类型/取值校验、不设 default：默认值由各消费方（config.get 的第二参）
  // 持有，schema 再写一份会让两处默认值各自漂移。新增项里只有 REQUEST_TIMEOUT_MS 带 default
  // （其消费方 TimeoutInterceptor 用 getOrThrow，默认值只此一处）。
  // 注：FILE_MAX_SIZE / UPLOAD_DIR / USER_STATUS_CACHE_TTL_SECONDS 等既有项的 default 属历史遗留，
  // 本次不动以缩小改动面；后续可单独收敛为单一来源。
  // 刷新令牌轮换（见 AuthService）
  REFRESH_TTL_SECONDS: Joi.number().integer().positive().optional(),
  // 0 = 每次刷新都轮换（AuthService.rotationMs 的 `< rotationMs()` 判定），故允许 0
  REFRESH_ROTATION_MS: Joi.number().integer().min(0).optional(),
  // 0 = 无复用宽限期（AuthService.reuseGraceSeconds 的 `< grace*1000` 判定），故允许 0
  REUSE_GRACE_SECONDS: Joi.number().min(0).optional(),
  // RedisBloom（登出/换发后的令牌撤销）：误报率须严格 0 < rate < 1
  // （BF.RESERVE 拒绝 1；rate=1 还会让过滤器恒判「存在」，令牌撤销退化为全部拒绝）
  BLOOM_ERROR_RATE: Joi.number().greater(0).less(1).optional(),
  BLOOM_CAPACITY: Joi.number().integer().positive().optional(),
  BLOOM_ROTATION_SECONDS: Joi.number().integer().positive().optional(),
  CORS_ORIGIN: Joi.string().allow('').optional(),
  // 读请求处理超时（毫秒）：<=0 表示禁用，由 TimeoutInterceptor 判定，故不设下限
  // （`.min(0)` 会拒绝 -1，与「<=0 禁用」矛盾）。上界取 setTimeout 的 32 位上限
  // （2^31-1）：超过会触发 TimeoutOverflowWarning 并按 1ms 处理，导致每个读请求立即 408。
  REQUEST_TIMEOUT_MS: Joi.number().integer().max(2_147_483_647).default(120000),
  // 文件存储
  FILE_MAX_SIZE: Joi.number().default(10485760),
  UPLOAD_DIR: Joi.string().default('uploads'),
  // 目前仅有本地驱动（@coool/file-nest 的 resolveStorageDriver 只认 local），
  // 写成别的值只会在文件元数据里静默错配，故限定取值；将来真支持多驱动再放开
  FILE_STORAGE: Joi.string().valid('local').optional(),
  // 日志（见 logger-options.ts）：等级限 pino 的合法取值，非法值在启动期即失败
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent')
    .optional(),
  LOG_DIR: Joi.string().allow('').optional(),
  LOG_FILE_RETENTION_DAYS: Joi.number().integer().positive().optional(),
  LOG_PRETTY: Joi.string().valid('0', '1').optional(),
  // Ollama / LangChain AI 对话
  OLLAMA_BASE_URL: Joi.string().uri().optional(),
  // 非空：消费者用 `config.get('OLLAMA_MODEL', '默认')`，而空串 != undefined，`??` 不会回退，
  // 空模型名会让 AI 对话在运行期失败——须在启动期拦下
  OLLAMA_MODEL: Joi.string().min(1).optional(),
  // 上界与 REQUEST_TIMEOUT_MS 同口径：都要喂给 setTimeout，超过 2^31-1 会按 1ms 处理
  OLLAMA_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .max(2_147_483_647)
    .optional(),
  AI_OUTPUT_MAX_TOKENS: Joi.number().integer().positive().optional(),
  AI_CONTEXT_TOKEN_LIMIT: Joi.number().integer().positive().optional(),
  AI_CONTEXT_SAFETY_MARGIN: Joi.number().integer().min(0).optional(),
  AI_TOKENIZER_CACHE_SIZE: Joi.number().integer().positive().optional(),
  // 系统提示可留空（= 不注入系统提示）
  AI_SYSTEM_PROMPT: Joi.string().allow('').optional(),
  // 标题提示非空：空串同样不会触发 `??` 回退，标题生成会失去指令
  AI_TITLE_PROMPT: Joi.string().min(1).optional(),
});
