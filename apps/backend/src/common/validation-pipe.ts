import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from './validation-exception-factory.js';

/**
 * 全局校验管道的**唯一定义处**：`CommonModule` 的 `APP_PIPE` 与测试都从这里取。
 *
 * 为什么不让测试自己 `new ValidationPipe({...})`：那样两份配置各写一份、毫无耦合，
 * 线上把 `forbidNonWhitelisted` 关掉（未知字段从 400 变成静默剥离）测试依旧全绿。
 * 测试断言的是**行为**，配置一旦只有这一份，行为变化就必然被断言捕获。
 *
 * 失败文案的归一（class-validator 英文默认提示 → 可读中文）也收在这份配置里，
 * 免得「调用方记得传 exceptionFactory」成为一条隐式约定。
 *
 * 也不用 `Test.createTestingModule({ imports: [CommonModule] }).get(APP_PIPE)` 取实例：
 * `APP_PIPE` 是 Nest 的 enhancer token，TestingModule 的 `get()` 会报
 * 「could not find APP_PIPE element (this provider does not exist in the current context)」。
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // 校验失败的文案由后端统一转成可读中文（见 validation-exception-factory）
    exceptionFactory: validationExceptionFactory,
  });
}
