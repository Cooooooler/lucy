/**
 * 分页契约常量——请求参数（各列表 DTO）、默认值与实现（KeysetPaginator、各 service）
 * 共用的**唯一定义处**：游标分页的 `limit` 与页码分页的 `pageSize` 同属「每页条数」这一个契约，
 * 因此共用同一组上下限。
 *
 * 为什么不能只放一半：
 * - 这些值是实际生效的默认值/边界，写死字面量时改一处就是文档、校验与实现静默漂移；
 *   它们进的是 `/docs` 的 OpenAPI 文档（`minimum`/`maximum`/`default`），不是 `@lucy/shared`
 *   的生成类型——query 参数在类型里只是 `pageSize?: number`，数值约束不可表达；
 * - 放在 DTO 或 `keyset-paginator.ts` 任一侧，都会让「参数契约」与「查询装配实现」
 *   互相 import。契约常量单独成文件，两侧都只依赖它。
 */
/** 默认每页条数（请求省略 `limit` / `pageSize` 时生效） */
export const DEFAULT_PAGE_SIZE = 20;

/** 每页条数上限（各列表 DTO 的 `@Max` 与 Swagger `maximum` 同源） */
export const MAX_PAGE_SIZE = 100;
