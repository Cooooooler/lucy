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

/**
 * 判定处理器是否标注为 SSE。两个拦截器（放行信封、放行超时）必须用**同一**判定，
 * 否则「是否 SSE」会各写一份而漂移：新增/改回 GET 型流式端点时，若其一漏改，该端点会被
 * 静默掐断（超时）或破坏流协议（包信封）。
 */
export function isSseHandler(handler: object): boolean {
  return Boolean(Reflect.getMetadata(SSE_METADATA, handler));
}
