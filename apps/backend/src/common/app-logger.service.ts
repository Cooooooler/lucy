import { Injectable, type LoggerService } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Logger } from 'nestjs-pino';

/**
 * 上下文日志器：把 CLS 中的 userId 自动注入每条业务日志。
 *
 * 用法：service 注入 AppLogger（而非 new Logger(Xxx)），调用时只传业务消息，
 * userId 由 CLS 上下文自动补齐。HTTP 请求内 userId 由 JwtAuthGuard 写入 CLS；
 * 非请求上下文（启动脚本/队列/测试）中 CLS 未激活时退化为不带 userId 的普通日志。
 *
 * 输出格式：`message user=xxx`（userId 缺失时为 `-`），与 AllExceptionsFilter
 * 的错误上下文格式一致，便于 grep user=<id> 一次检索某用户全链路。
 *
 * 实现委托给 nestjs-pino 的 Logger 而非 console：业务日志因此与其余日志走同一条
 * pino 管道，既能命中全局 redact 脱敏（不绕过安全配置），又输出带 reqId 的结构化
 * JSON，便于采集端按请求链路检索。
 */
@Injectable()
export class AppLogger implements LoggerService {
  constructor(
    private readonly cls: ClsService,
    private readonly logger: Logger,
  ) {}

  log(message: string, context?: string): void {
    this.logger.log(this.withUser(message), context);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(this.withUser(message), context);
  }

  error(message: string, trace?: string, context?: string): void {
    const text = this.withUser(message);
    // 无 trace 时只传 context，避免把 undefined 当作插值参数交给 pino
    if (trace) {
      this.logger.error(text, trace, context);
    } else {
      this.logger.error(text, context);
    }
  }

  debug(message: string, context?: string): void {
    this.logger.debug(this.withUser(message), context);
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(this.withUser(message), context);
  }

  private withUser(message: string): string {
    return `${message} user=${this.userId()}`;
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
