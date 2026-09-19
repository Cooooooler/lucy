import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.constants.js';

/**
 * 分页入参归一化——游标分页（`limit`）与页码分页（`page`/`pageSize`）共用的**同一处边界策略**。
 *
 * 为什么实现层还要再守一道：`@Min`/`@Max`/`@IsInt` 只作用于 HTTP 入参路径，而各列表
 * service 收的是结构化类型或裸 number，内部复用方（别的模块的列表、拼上下文）能直接
 * 给值。越界的每页条数会变成一次全量 LIMIT 扫描；非数值、非正数、非整数还会拼出非法
 * SQL（`LIMIT 2.5`、负 LIMIT）在运行期变成 500。两条分页路径共用这里，边界策略不会各自漂移。
 */

/**
 * 归一化每页条数到契约区间 `[1, MAX_PAGE_SIZE]`：未传或 NaN 回退默认值，其余（含 ±Infinity）
 * 一律按「越界」钳到边界 —— 把 `+Infinity` 当作「未传」回退默认值，会让同一个函数对 `-5`
 * （钳到 1）与 `+Infinity` 采取两种口径。
 */
export function resolvePageSize(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

/**
 * 归一化页码：低于 1 或非安全整数回退第 1 页。
 *
 * 页码**不设上界**（深翻页由 OFFSET 语义决定，合法页码原样返回），但必须挡住 `1e300` 这类
 * 非安全整数：`Number.isInteger` 判为真、`@IsInt` 因此放行，它算出的
 * `OFFSET (page - 1) * pageSize` 超出 Postgres int8 上限（约 9.2e18），查询在解析阶段报
 * `bigint out of range`，被全局过滤器兜成 500。每页条数的上限由 {@link resolvePageSize} 负责。
 */
export function resolvePageNumber(value: number | undefined): number {
  const page = value === undefined ? Number.NaN : Math.trunc(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}
