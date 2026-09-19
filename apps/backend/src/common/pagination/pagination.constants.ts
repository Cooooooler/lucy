/**
 * 分页契约常量——请求参数（各列表 DTO）、默认值与实现（KeysetPaginator、各 service）
 * 共用的**唯一定义处**：游标分页的 `limit` 与页码分页的 `pageSize` 同属「每页条数」这一个契约，
 * 因此共用同一组上下限。
 *
 * 为什么不能只放一半：
 * - 这些值会经 `pnpm typegen` 进入 `@lucy/shared` 契约与前端文档，写死字面量时改一处
 *   就是文档与实现静默漂移；
 * - 放在 DTO 或 `keyset-paginator.ts` 任一侧，都会让「参数契约」与「查询装配实现」
 *   互相 import。契约常量单独成文件，两侧都只依赖它。
 */
/** 默认每页条数（请求省略 `limit` / `pageSize` 时生效） */
export const DEFAULT_PAGE_SIZE = 20;

/** 每页条数上限（各列表 DTO 的 `@Max` 与 Swagger `maximum` 同源） */
export const MAX_PAGE_SIZE = 100;
