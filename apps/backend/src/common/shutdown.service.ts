import {
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from './app-logger.service.js';

/**
 * 停机状态与兜底强退。
 *
 * 停机位在 `beforeApplicationShutdown` 就置起（早于 HTTP 服务器被 dispose）：停机窗口内
 * 新请求可被拒绝、`/health/ready` 也能被观察到；`onApplicationShutdown` 表示停机生命周期
 * 已走完，此时撤销兜底定时器 —— 定时器在这里起、也在这里销，避免「成功停机后仍被强退」。
 * 兜底判据是**整个停机过程**超过 `SHUTDOWN_GRACE_MS`（例如仍有卡住的连接/in-flight 流），
 * 而不是某个句柄没关。
 */
@Injectable()
export class ShutdownService
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private shuttingDown = false;
  private forceExitTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  startShutdown(): void {
    this.shuttingDown = true;
  }

  isShutdown(): boolean {
    return this.shuttingDown;
  }

  beforeApplicationShutdown(): void {
    this.startShutdown();
    this.armForceExit();
  }

  onApplicationShutdown(): void {
    this.startShutdown();
    if (this.forceExitTimer) {
      clearTimeout(this.forceExitTimer);
      this.forceExitTimer = undefined;
    }
  }

  // 兜底：停机超过宽限期仍未完成（有连接卡住）即强制退出，避免编排器等到自己的超时才杀
  private armForceExit(): void {
    const graceMs = Number(this.config.getOrThrow<number>('SHUTDOWN_GRACE_MS'));
    this.forceExitTimer = setTimeout(() => {
      this.logger.error(
        `优雅停机超过 ${graceMs}ms 仍未完成，强制退出`,
        ShutdownService.name,
      );
      process.exit(1);
    }, graceMs);
    // 定时器本身不阻止进程退出
    this.forceExitTimer.unref?.();
  }
}
