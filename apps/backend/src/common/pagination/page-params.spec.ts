import { describe, expect, it } from 'vitest';
import { resolvePageNumber, resolvePageSize } from './page-params.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.constants.js';

/**
 * 两条分页路径共用的入参守卫：这里钉住的是「越界值不会进 SQL」这一契约，
 * 各 service / KeysetPaginator 的用例只验证它们确实走了这里。
 */
describe('resolvePageSize', () => {
  it('未传时取默认值', () => {
    expect(resolvePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('NaN 回退默认值，不拼进 LIMIT', () => {
    expect(resolvePageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('±Infinity 按越界钳到边界（不是当「未传」回退默认值）', () => {
    expect(resolvePageSize(Number.POSITIVE_INFINITY)).toBe(MAX_PAGE_SIZE);
    expect(resolvePageSize(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it('0 与负数钳到下界 1', () => {
    expect(resolvePageSize(0)).toBe(1);
    expect(resolvePageSize(-5)).toBe(1);
  });

  it('超过上限钳到 MAX_PAGE_SIZE（挡全量 LIMIT 扫描）', () => {
    expect(resolvePageSize(10 ** 9)).toBe(MAX_PAGE_SIZE);
    expect(resolvePageSize(MAX_PAGE_SIZE + 1)).toBe(MAX_PAGE_SIZE);
  });

  it('区间内的合法值原样返回（含边界）', () => {
    expect(resolvePageSize(1)).toBe(1);
    expect(resolvePageSize(7)).toBe(7);
    expect(resolvePageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });

  it('小数截断为整数（`LIMIT 2.5` 是非法 SQL）', () => {
    expect(resolvePageSize(2.9)).toBe(2);
  });
});

describe('resolvePageNumber', () => {
  it('未传或非数值回退第 1 页', () => {
    expect(resolvePageNumber(undefined)).toBe(1);
    expect(resolvePageNumber(Number.NaN)).toBe(1);
  });

  it('小于 1 的页码回退第 1 页（负 OFFSET 会让 Postgres 报错）', () => {
    expect(resolvePageNumber(0)).toBe(1);
    expect(resolvePageNumber(-3)).toBe(1);
  });

  it('合法页码原样返回，不设上界（深翻页由 OFFSET 语义决定）', () => {
    expect(resolvePageNumber(1)).toBe(1);
    expect(resolvePageNumber(1000)).toBe(1000);
    expect(resolvePageNumber(10 ** 9)).toBe(10 ** 9);
  });

  it('非安全整数回退第 1 页（1e300 会让 OFFSET 溢出 Postgres int8 变 500）', () => {
    // `Number.isFinite`/`@IsInt` 都放行 1e300：(page-1)*pageSize ≈ 1e302 超过 int8 上限，
    // Postgres 报 bigint out of range，被全局过滤器兜成 500
    expect(resolvePageNumber(1e300)).toBe(1);
    expect(resolvePageNumber(Number.MAX_SAFE_INTEGER + 1)).toBe(1);
    expect(resolvePageNumber(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
