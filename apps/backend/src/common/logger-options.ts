import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import pretty from 'pino-pretty';

/** 本地日志目录（根 .gitignore 已忽略 logs/ 与 *.log） */
const LOG_DIR = join(process.cwd(), 'logs');

function isProd() {
  return process.env.NODE_ENV === 'production';
}

/** 是否在控制台输出 pino-pretty 美化日志（开发或显式开启） */
function usePretty() {
  return process.env.LOG_PRETTY === '1' || !isProd();
}

/**
 * 请求级链路追踪 ID：透传 x-request-id / x-trace-id，否则生成 UUID 并回写响应头。
 * 每个请求产出的所有日志（req.id）都会带上该 ID，可据此串联整条调用链。
 */
export function genReqId(
  req: {
    headers: Record<string, string | string[] | undefined>;
  },
  res: { setHeader: (name: string, value: string) => void },
): string {
  // 逐一校验并 trim 候选头：优先取有效 x-request-id，其次有效 x-trace-id，两者皆无效才生成 UUID。
  // 先判定 x-request-id 是否存在会放过「空白值遮盖有效 x-trace-id」的情况，故对每个头单独校验。
  const candidates = ['x-request-id', 'x-trace-id'];
  for (const name of candidates) {
    const value = req.headers[name];
    const existing = Array.isArray(value) ? value[0] : value;
    if (typeof existing === 'string' && existing.trim()) {
      const id = existing.trim();
      res.setHeader('x-request-id', id);
      return id;
    }
  }
  const id = randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/**
 * 构建 nestjs-pino 全局 Logger 配置：
 * - 控制台：pino-pretty 美化输出（开发），多行展示错误堆栈，保证报错清晰易读；
 *   生产未开 LOG_PRETTY 时输出纯 JSON 便于采集。
 * - 本地落盘：非生产环境额外写 JSON 日志到 logs/backend-YYYY-MM-DD.log（已 gitignore），
 *   每条含 req.id（traceId），可通过 traceId 检索单条请求的完整链路。
 * - 敏感字段脱敏（authorization / cookie / password 等），遵循安全加固要求。
 */
export function loggerModuleOptions(): Params {
  const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;
  const streams: pino.StreamEntry[] = [
    usePretty()
      ? {
          level,
          stream: pretty({
            // 多行输出，错误堆栈逐行展示可读；默认彩色
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          }),
        }
      : { level, stream: process.stdout },
  ];

  if (!isProd()) {
    mkdirSync(LOG_DIR, { recursive: true });
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    streams.push({
      level,
      stream: pino.destination(join(LOG_DIR, `backend-${date}.log`)),
    });
  }

  return {
    pinoHttp: {
      level,
      genReqId,
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
      stream: pino.multistream(streams),
    },
    renameContext: 'context',
  };
}
