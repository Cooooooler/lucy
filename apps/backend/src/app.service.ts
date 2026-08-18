import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  // 根路径（/）响应，由 AppController 暴露并标记 @Public，作为最简单的健康检查
  getHello(): string {
    return 'Hello World!';
  }
}
