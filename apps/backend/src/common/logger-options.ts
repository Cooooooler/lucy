import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pretty from 'pino-pretty';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 本地日志目录：固定为 apps/backend/logs（相对本文件定位，不随启动 cwd 漂移），
 * 可用 LOG_DIR 环境变量覆盖。根 .gitignore 已忽略 logs/ 与 *.log。
 */
export function resolveLogDir(): string {
  return process.env.LOG_DIR || join(__dirname, '..', '..', 'logs');
}

/** 本地日志保留天数（默认 7），非法值回退默认 */
function logRetentionDays(): number {
  const v = Number(process.env.LOG_FILE_RETENTION_DAYS ?? 7);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 7;
}

/**
 * 清理超期日志文件（backend-YYYY-MM-DD.log），保留近期文件。
 * 失败静默：日志清理绝不能阻塞应用启动。
 */
export function pruneOldLogs(dir: string, keepDays: number): void {
  try {
    const cutoff = Date.now() - keepDays * 86_400_000;
    for (const name of readdirSync(dir)) {
      const m = /^backend-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
      if (!m) continue;
      const ts = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime();
      if (Number.isFinite(ts) && ts < cutoff) {
        try {
          rmSync(join(dir, name));
        } catch {
          // 忽略单个文件删除失败
        }
      }
    }
  } catch {
    // 忽略目录不可读等情况
  }
}

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
 * - 等级：LOG_LEVEL（默认 info）同时控制控制台与落盘流。
 * - 本地落盘：非生产环境额外写 JSON 日志到 apps/backend/logs/backend-YYYY-MM-DD.log
 *   （已 gitignore，目录可用 LOG_DIR 覆盖），超期文件按 LOG_FILE_RETENTION_DAYS
 *   （默认 7 天）在启动时清理；production 不落盘，只走 stdout JSON。
 * - 每条含 req.id（traceId），可通过 traceId 检索单条请求的完整链路。
 * - 敏感字段脱敏（authorization / cookie / password / token 等），遵循安全加固要求。
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
    const dir = resolveLogDir();
    try {
      mkdirSync(dir, { recursive: true });
      pruneOldLogs(dir, logRetentionDays());
    } catch {
      // 目录不可写时跳过落盘，控制台流仍可用
    }
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    streams.push({
      level,
      stream: pino.destination(join(dir, `backend-${date}.log`)),
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
          '*.accessToken',
          '*.token',
          '*.secret',
        ],
        censor: '[REDACTED]',
      },
      stream: pino.multistream(streams),
    },
    renameContext: 'context',
  };
}
