import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordModule } from '../password/password.module.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User]), PasswordModule],
  providers: [UsersService],
  exports: [UsersService, PasswordModule],
})
export class UsersModule {}
