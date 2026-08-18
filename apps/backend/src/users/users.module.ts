import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordModule } from '../password/password.module.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

/**
 * 用户领域模块：提供 User 实体仓储与 UsersService。
 * re-export PasswordModule，使依赖方（如 AuthModule）只需导入本模块即可注入 PasswordService。
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), PasswordModule],
  providers: [UsersService],
  exports: [UsersService, PasswordModule],
})
export class UsersModule {}
