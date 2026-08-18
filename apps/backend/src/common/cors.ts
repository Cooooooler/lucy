/** 从 CORS_ORIGIN 环境变量解析跨源白名单（逗号分隔、去空格）；未配置返回 false（仅同源，不开放 CORS） */
export function resolveCorsOrigin(
  env = process.env.CORS_ORIGIN,
): string[] | false {
  return env ? env.split(',').map((s) => s.trim()) : false;
}
