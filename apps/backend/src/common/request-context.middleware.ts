import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

/**
 * 请求上下文中间件：在 CLS 命名空间中写入 userId，供全链路日志消费。
 *
 * - 守卫先于中间件？否：Express 中间件先于守卫执行，此时 req.user 尚未由
 *   JwtAuthGuard 填充，故此处只能写入默认值（匿名）；真正的 userId 由
 *   JwtAuthGuard 验证通过后补写（见 jwt-auth.guard.ts）。
 * - 中间件职责仅是“占位初始化”，保证任何后续代码（守卫/拦截器/service）
 *   都能安全地 cls.get('userId') 而不遇到“命名空间未激活”。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    if (!this.cls.isActive()) {
      next();
      return;
    }
    if (!this.cls.has('userId')) {
      this.cls.set('userId', null);
    }
    next();
  }
}
