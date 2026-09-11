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
import { Roles } from '../common/decorators/roles.decorator.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';
import { UserListQueryDto } from './dto/user-list-query.dto.js';
import { User, UserRole } from './user.entity.js';
import { UsersService } from './users.service.js';

/** 用户管理：整类仅 admin 可访问，角色由全局 RolesGuard 依据 @Roles 元数据校验。 */
@ApiTags('users')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller({ path: 'users', version: API_VERSION })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: '用户列表',
    description: '分页查询用户，支持状态与关键字过滤',
  })
  list(@Query() query: UserListQueryDto) {
    return this.usersService.list(query);
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
    description: '禁用后该用户已签发的令牌立即不可用',
  })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: '用户不存在' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(id, dto.status);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '删除用户',
    description: '级联清理该用户关联数据，其令牌立即不可用',
  })
  @ApiResponse({ status: 404, description: '用户不存在' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
