import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_NUMBER,
  MAX_PAGE_SIZE,
} from './pagination.constants.js';

/**
 * 分页入参归一化——游标分页（`limit`）与页码分页（`page`/`pageSize`）共用的**同一处边界策略**。
 *
 * 为什么实现层还要再守一道：`@Min`/`@Max`/`@IsInt` 只作用于 HTTP 入参路径，而各列表
 * service 收的是结构化类型或裸 number，内部复用方（别的模块的列表、拼上下文）能直接
 * 给值。越界的每页条数会变成一次全量 LIMIT 扫描；非数值、非正数、非整数还会拼出非法
 * SQL（`LIMIT 2.5`、负 LIMIT）在运行期变成 500。两条分页路径共用这里，边界策略不会各自漂移。
 */

/** 归一化每页条数到契约区间 `[1, MAX_PAGE_SIZE]`：非数值回退默认值，越界钳到边界 */
export function resolvePageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE);
}

/**
 * 归一化页码到契约区间 `[1, MAX_PAGE_NUMBER]`：非安全整数（含 NaN/±Infinity/1e300）与越界值
 * 一律回退第 1 页。
 *
 * 为什么不能只用 `Number.isFinite`：`1e300` 是有限整数——`Number.isInteger` 为真，`@IsInt`
 * 因此放行——它会算出 1e302 的 OFFSET，超出 Postgres int8 上限，查询在解析阶段报
 * `bigint out of range` 被全局过滤器兜成 500。
 */
export function resolvePageNumber(value: number | undefined): number {
  const page = value === undefined ? Number.NaN : Math.trunc(value);
  if (!Number.isSafeInteger(page)) return 1;
  return page >= 1 && page <= MAX_PAGE_NUMBER ? page : 1;
}
