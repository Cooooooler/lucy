import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AiService } from './ai.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { RenameConversationDto } from './dto/rename-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { Conversation } from './entities/conversation.entity.js';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('conversations')
  @ApiOperation({ summary: '创建会话', description: '新建一个 AI 对话会话' })
  @ApiResponse({ status: 201, description: '创建成功', type: Conversation })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateConversationDto,
  ): Promise<Conversation> {
    return this.aiService.create(user.userId, dto);
  }

  @Get('conversations')
  @ApiOperation({ summary: '会话列表', description: '按更新时间倒序分页' })
  @ApiResponse({ status: 200, description: '返回 PageResult<Conversation>' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.aiService.list(user.userId, Number(page), Number(pageSize));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话详情', description: '含消息列表（时间正序）' })
  @ApiResponse({
    status: 200,
    description: '返回会话及消息',
    type: Conversation,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<Conversation> {
    return this.aiService.get(user.userId, id);
  }

  @Patch('conversations/:id')
  @ApiOperation({ summary: '改名', description: '修改会话标题' })
  @ApiResponse({
    status: 200,
    description: '返回更新后会话',
    type: Conversation,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  rename(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RenameConversationDto,
  ): Promise<Conversation> {
    return this.aiService.rename(user.userId, id, dto.title);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除会话', description: '级联删除该会话全部消息' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '会话不存在' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    return this.aiService.remove(user.userId, id);
  }

  // 注意：@Post 必须写在 @Sse 上方——@Sse 内部把 HTTP 方法置为 GET，@Post 在上方覆盖回 POST
  @Post('conversations/:id/messages')
  @Sse('conversations/:id/messages')
  @ApiOperation({
    summary: '发送消息',
    description: 'SSE 流式返回模型回复，事件：delta/done/error',
  })
  send(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Observable<MessageEvent> {
    return this.aiService.sendMessage(user.userId, id, dto);
  }
}
