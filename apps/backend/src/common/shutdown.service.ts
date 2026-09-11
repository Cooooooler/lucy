import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownService implements OnApplicationShutdown {
  private shuttingDown = false;

  startShutdown(): void {
    this.shuttingDown = true;
  }

  isShutdown(): boolean {
    return this.shuttingDown;
  }

  onApplicationShutdown(): void {
    this.startShutdown();
  }
}
