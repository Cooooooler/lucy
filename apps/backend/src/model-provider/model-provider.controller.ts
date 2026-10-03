import { API_VERSION } from '@lucy/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
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
import { SuccessMessage } from '../common/decorators/success-message.decorator.js';
import { UUIDParam } from '../common/pipes/uuid-param.js';
import { CreateModelProviderDto } from './dto/create-model-provider.dto.js';
import { ModelProviderListQueryDto } from './dto/model-provider-list-query.dto.js';
import {
  ModelProviderItemDto,
  ModelProviderListResultDto,
} from './dto/model-provider-list-result.dto.js';
import { ModelProviderTestResultDto } from './dto/model-provider-test-result.dto.js';
import { UpdateModelProviderDto } from './dto/update-model-provider.dto.js';
import { ModelConnectionService } from './model-connection.service.js';
import { ModelProviderService } from './model-provider.service.js';

@ApiTags('model-provider')
@ApiBearerAuth()
// 统一返回允许式 DTO（ModelProviderItemDto / ModelProviderListResultDto），不以实体当契约：
// 实体上的 API Key 密文/尾号即使漏标 @Exclude，也不会进入真实响应。
@Controller({ path: 'model-providers', version: API_VERSION })
export class ModelProviderController {
  constructor(
    private readonly service: ModelProviderService,
    // 连接测试会真实发起外部调用，与元信息 CRUD 分属两件事，控制器分别注入
    private readonly connection: ModelConnectionService,
  ) {}

  @Post()
  @SuccessMessage('模型创建成功')
  @ApiOperation({ summary: '创建模型' })
  @ApiResponse({ status: 201, type: ModelProviderItemDto })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateModelProviderDto,
  ): Promise<ModelProviderItemDto> {
    return this.service.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: '模型列表（游标分页）',
    description: '仅返回当前用户创建的模型；用响应中的 nextCursor 翻页',
  })
  @ApiResponse({ status: 200, type: ModelProviderListResultDto })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ModelProviderListQueryDto,
  ): Promise<ModelProviderListResultDto> {
    return this.service.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '模型详情' })
  @ApiResponse({ status: 200, type: ModelProviderItemDto })
  @ApiResponse({ status: 404, description: '模型不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
  ): Promise<ModelProviderItemDto> {
    return this.service.get(user.userId, id);
  }

  @Patch(':id')
  @SuccessMessage('模型更新成功')
  @ApiOperation({
    summary: '更新模型',
    description: 'apiKey 省略表示保留原 Key；传值则覆盖',
  })
  @ApiResponse({ status: 200, type: ModelProviderItemDto })
  @ApiResponse({ status: 404, description: '模型不存在' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
    @Body() dto: UpdateModelProviderDto,
  ): Promise<ModelProviderItemDto> {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  @SuccessMessage('模型已删除')
  @ApiOperation({ summary: '删除模型' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '模型不存在' })
  remove(@CurrentUser() user: CurrentUserPayload, @UUIDParam('id') id: string) {
    return this.service.remove(user.userId, id);
  }

  @Post(':id/test-connection')
  // 「测试」是只读语义的动作而非资源创建：显式 200，避免 Nest 对 POST 默认返回 201
  @HttpCode(HttpStatus.OK)
  // 不设 @SuccessMessage：结果（成功/失败）由前端据 ok 自行提示，避免与全局成功桥重复
  @ApiOperation({
    summary: '测试连接',
    description:
      '用配置的 Key/Base URL/协议发起一次最小调用。返回 200 + ok 表达结论；不支持的类型与不可达地址都以 ok=false 返回',
  })
  @ApiResponse({ status: 200, type: ModelProviderTestResultDto })
  @ApiResponse({ status: 404, description: '模型不存在' })
  testConnection(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
  ): Promise<ModelProviderTestResultDto> {
    return this.connection.test(user.userId, id);
  }
}
