import { API_VERSION } from '@lucy/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/roles.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { UserListQueryDto } from './dto/user-list-query.dto.js';
import {
  UserListItemDto,
  UserListResultDto,
} from './dto/user-list-result.dto.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

/**
 * 用户管理：整类要求 admin 及以上（@Roles 为层级语义，superadmin 同样可访问），
 * 由全局 RolesGuard 依据 @Roles 元数据校验。变更操作另有层级限制：仅可操作级别
 * 严格低于自己的账号（admin 只能动普通用户，superadmin 可动管理员）。
 */
@ApiTags('users')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller({ path: 'users', version: API_VERSION })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: '用户列表',
    description: '分页查询用户，支持状态与关键字过滤；列表始终排除操作者自己',
  })
  @ApiResponse({ status: 200, type: UserListResultDto })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: UserListQueryDto,
  ): Promise<{
    list: UserListItemDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.usersService.list(
      { userId: user.userId, role: user.role },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '用户详情' })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: '用户不存在' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getDetail(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: '启用/禁用用户',
    description:
      '禁用后该用户已签发的令牌立即不可用；仅可操作级别低于自己的账号（admin 只能操作普通用户，superadmin 可操作管理员），不能操作自己',
  })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({
    status: 403,
    description: '不能操作自己或同级/更高级别的账号',
  })
  @ApiResponse({ status: 404, description: '用户不存在' })
  updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(
      { userId: user.userId, role: user.role },
      id,
      dto.status,
    );
  }

  @Patch(':id/role')
  @Roles(UserRole.SuperAdmin)
  @ApiOperation({
    summary: '修改用户角色',
    description:
      '仅 superadmin 可调用，在 user / admin 之间调整；superadmin 不经接口授予，不能修改自己',
  })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({
    status: 403,
    description:
      '仅 superadmin 可调用；不能修改自己、同级/更高级别账号，或授予同级/更高级别角色',
  })
  @ApiResponse({ status: 404, description: '用户不存在' })
  updateRole(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateRole(
      { userId: user.userId, role: user.role },
      id,
      dto.role,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: '删除用户',
    description:
      '级联清理该用户关联数据，其令牌立即不可用；仅可删除级别低于自己的账号（admin 只能删除普通用户，superadmin 可删除管理员），不能删除自己',
  })
  @ApiResponse({
    status: 403,
    description: '不能删除自己或同级/更高级别的账号',
  })
  @ApiResponse({ status: 404, description: '用户不存在' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.usersService.remove(
      { userId: user.userId, role: user.role },
      id,
    );
  }
}
