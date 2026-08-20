import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

/**
 * 构建 nestjs-pino 全局 Logger 配置：
 * - JSON 结构化日志（生产）或 pino-pretty 美化输出（开发）
 * - 请求级 request-id 关联（透传 x-request-id，否则生成 UUID 并回写响应头）
 * - 敏感字段脱敏（authorization / cookie / password 等），遵循安全加固要求
 */
export function loggerModuleOptions(): Params {
  const pretty =
    process.env.LOG_PRETTY === '1' || process.env.NODE_ENV !== 'production';
  return {
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? 'info',
      genReqId: (req, res) => {
        const header = req.headers['x-request-id'];
        const existing = Array.isArray(header) ? header[0] : header;
        const id = existing ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.refreshToken',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss',
              colorize: true,
            },
          }
        : undefined,
    },
    renameContext: 'context',
  };
}
