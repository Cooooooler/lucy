import { Module } from '@nestjs/common';
import { PasswordService } from './password.service.js';

/** 密码哈希/校验能力（scrypt），供 Users、Auth 等模块复用 */
@Module({
  providers: [PasswordService],
  exports: [PasswordService],
})
export class PasswordModule {}
