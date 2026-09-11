import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module.js';
import { PasswordModule } from '../password/password.module.js';
import { UserAccessService } from './user-access.service.js';
import { User } from './user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/**
 * 用户领域模块：提供 User 实体仓储、UsersRepository（数据访问封装）、
 * UsersService（业务）与 UserAccessService（鉴权快照缓存），并暴露用户管理接口。
 * re-export PasswordModule，使依赖方（如 AuthModule）只需导入本模块即可注入 PasswordService。
 * 导入 CommonModule 以使用 AppLogger（UserAccessService 记录缓存降级告警）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), PasswordModule, CommonModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService, UserAccessService],
  exports: [UsersService, UsersRepository, UserAccessService, PasswordModule],
})
export class UsersModule {}
