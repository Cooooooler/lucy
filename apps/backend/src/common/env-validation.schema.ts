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
  // 刷新令牌轮换：长效 TTL / 时间化轮换间隔 / 复用宽限期（见 AuthService）
  REFRESH_TTL_SECONDS: Joi.number().integer().positive().default(604800),
  REFRESH_ROTATION_MS: Joi.number().integer().positive().default(600000),
  REUSE_GRACE_SECONDS: Joi.number().positive().default(10),
  // RedisBloom（登出/换发后的令牌撤销）
  BLOOM_ERROR_RATE: Joi.number().greater(0).max(1).default(0.01),
  BLOOM_CAPACITY: Joi.number().integer().positive().default(1000000),
  BLOOM_ROTATION_SECONDS: Joi.number().integer().positive().default(900),
  CORS_ORIGIN: Joi.string().allow('').optional(),
  // 请求处理超时（毫秒，<=0 视为禁用；见 TimeoutInterceptor）
  REQUEST_TIMEOUT_MS: Joi.number().integer().min(0).default(120000),
  // 优雅停机宽限期（毫秒）：超时后强制退出（见 main.ts）
  SHUTDOWN_GRACE_MS: Joi.number().integer().positive().default(15000),
  // 文件存储
  FILE_MAX_SIZE: Joi.number().default(10485760),
  UPLOAD_DIR: Joi.string().default('uploads'),
  FILE_STORAGE: Joi.string().default('local'),
  // 日志（见 logger-options.ts）
  LOG_LEVEL: Joi.string().default('info'),
  LOG_DIR: Joi.string().allow('').optional(),
  LOG_FILE_RETENTION_DAYS: Joi.number().integer().positive().default(7),
  LOG_PRETTY: Joi.string().valid('0', '1').optional(),
  // Ollama / LangChain AI 对话
  OLLAMA_BASE_URL: Joi.string().default('http://localhost:11434'),
  OLLAMA_MODEL: Joi.string().default('qwen2.5:7b'),
  OLLAMA_TIMEOUT_MS: Joi.number().integer().positive().default(120000),
  AI_OUTPUT_MAX_TOKENS: Joi.number().integer().positive().default(32768),
  AI_CONTEXT_TOKEN_LIMIT: Joi.number().integer().positive().default(131072),
  AI_CONTEXT_SAFETY_MARGIN: Joi.number().integer().min(0).default(2048),
  AI_TOKENIZER_CACHE_SIZE: Joi.number().integer().positive().default(1000),
  AI_SYSTEM_PROMPT: Joi.string().allow('').optional(),
  AI_TITLE_PROMPT: Joi.string().allow('').optional(),
});
