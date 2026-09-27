/**
 * SSE 端点的元数据键：`@nestjs/common` 的 `Sse` 装饰器写入的键（值 `__sse__` 与官方
 * `@nestjs/common/constants` 中 `SSE_METADATA` 一致）。以字面量固化而非 deep import
 * `@nestjs/common/constants`，因为该包无 exports 映射，在 nodenext + TS6 下无法通过类型解析。
 *
 * 独立成中立模块：由 `ApiResponseInterceptor`（放行 SSE，不包信封）、`TimeoutInterceptor`
 * （放行 SSE，不套超时）与 `AiController`（标注 SSE 端点）共同依赖。若把常量留在某个拦截器里，
 * 另一个拦截器就得反向 import 它——两个职责无关的拦截器会因共享一个协议常量而互相耦合。
 */
export const SSE_METADATA = '__sse__';
