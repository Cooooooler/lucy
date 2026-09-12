import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { UserRole } from '../../common/roles.js';

export class UpdateUserRoleDto {
  @ApiProperty({
    description:
      '目标角色：仅允许 user / admin；superadmin 只能经数据库直接提升，不经接口授予',
    enum: [UserRole.User, UserRole.Admin],
    example: UserRole.Admin,
  })
  @IsString()
  @IsIn([UserRole.User, UserRole.Admin])
  role: UserRole;
}
