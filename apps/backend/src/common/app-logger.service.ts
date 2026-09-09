import { Injectable, type LoggerService } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

/**
 * 上下文日志器：把 CLS 中的 userId 自动注入每条业务日志。
 *
 * 用法：service 注入 AppLogger（而非 new Logger(Xxx)），调用时只传业务消息，
 * userId 由 CLS 上下文自动补齐。HTTP 请求内 userId 由 JwtAuthGuard 写入 CLS；
 * 非请求上下文（启动脚本/队列/测试）中 CLS 未激活时退化为不带 userId 的普通日志。
 *
 * 输出格式：`message user=xxx`（userId 缺失时为 `-`），与 AllExceptionsFilter
 * 的错误上下文格式一致，便于 grep user=<id> 一次检索某用户全链路。
 */
@Injectable()
export class AppLogger implements LoggerService {
  constructor(private readonly cls: ClsService) {}

  log(message: string, context?: string): void {
    this.write('log', message, context);
  }

  warn(message: string, context?: string): void {
    this.write('warn', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    const suffix = trace ? `\n${trace}` : '';
    this.write('error', `${message}${suffix}`, context);
  }

  debug(message: string, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: string, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(
    level: 'log' | 'warn' | 'error' | 'debug' | 'verbose',
    message: string,
    context?: string,
  ): void {
    const target = level === 'verbose' ? 'debug' : level;
    const fn = (...args: string[]): void => {
      console[target](...args);
    };
    const ctx = context ? ` [${context}]` : '';
    fn(`${message} user=${this.userId()}${ctx}`);
  }

  private userId(): string {
    try {
      if (!this.cls.isActive()) return '-';
      return (this.cls.get<string | null>('userId') ?? '-') || '-';
    } catch {
      return '-';
    }
  }
}
