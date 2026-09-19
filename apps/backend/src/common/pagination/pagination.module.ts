import { Module } from '@nestjs/common';
import { KeysetPaginator } from './keyset-paginator.js';

/**
 * 游标分页装配的宿主模块。
 *
 * 独立成模块（而不是塞进某个特性模块的 providers）的原因：`KeysetPaginator` 只依赖
 * QueryBuilder 的装配语义，与实体、授权、文件存储都无关。挂在特性模块里时，其它模块
 * 想复用它只能 `imports` 那个无关特性（引入反向耦合），或自行 `provide` 一份
 * （重复实例，配置漂移时两个模块的行为会不一致）。
 */
@Module({
  providers: [KeysetPaginator],
  exports: [KeysetPaginator],
})
export class PaginationModule {}
