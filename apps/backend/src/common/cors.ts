/**
 * 从 CORS_ORIGIN 解析跨源白名单（逗号分隔、去空格）；未配置返回 false（仅同源，不开放 CORS）。
 *
 * 入参由调用方经 `ConfigService` 取（`main.ts`），不在这里直读 `process.env`：
 * env 的取值/校验集中在 `envValidationSchema` 一处，绕过它会让「配错了也不报错」的键
 * 在启动期漏过校验（见 `logger-options.ts` 的同类说明）。
 */
export function resolveCorsOrigin(env: string | undefined): string[] | false {
  return env ? env.split(',').map((s) => s.trim()) : false;
}
