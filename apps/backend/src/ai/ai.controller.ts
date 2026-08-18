import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  SetMetadata,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SSE_METADATA } from '../common/interceptors/api-response.interceptor.js';
import { AiService } from './ai.service.js';
import { ConversationListQueryDto } from './dto/conversation-list-query.dto.js';
import { ConversationListResultDto } from './dto/conversation-list-result.dto.js';
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
  @ApiResponse({
    status: 200,
    description: '返回分页会话列表',
    type: ConversationListResultDto,
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: ConversationListQueryDto,
  ) {
    return this.aiService.list(
      user.userId,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
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
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    return this.aiService.remove(user.userId, id);
  }

  // POST 流式接口：手动写 `data: <json>` 帧（OpenAI 风格），流末尾 `data: [DONE]` 终止。
  // @SetMetadata 复用 ApiResponseInterceptor 的 SSE 放行标记，避免信封包裹破坏流协议
  @Post('conversations/:id/messages')
  @SetMetadata(SSE_METADATA, true)
  @ApiOperation({
    summary: '发送消息',
    description: `SSE 流式返回模型回复：
    
    data: {"type":"delta","requestId":"req-123","role":"ai","data":{"content":"你好"}}

    data: {"type":"delta","requestId":"req-123","role":"ai","data":{"content":"，我是AI助手"}}

    data: {"type":"error","requestId":"req-123","data":{"code":50002,"message":"模型调用超时"}}

    data: {"type":"done","requestId":"req-123","role":"ai","data":{"finish_reason":"stop"}}

    data: [DONE]
    `,
  })
  send(
    @Res({
      passthrough: true,
    })
    res: Response,
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subscription = this.aiService
      .sendMessage(user.userId, id, dto)
      .subscribe({
        next: (event) => {
          if (!res.destroyed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        },
        complete: () => {
          if (!res.destroyed && !res.writableEnded) {
            res.write('data: [DONE]\n\n');
          }
          res.end();
        },
      });
    // 客户端断开时取消订阅，触发 service 的 AbortController 中断模型流
    res.on('close', () => subscription.unsubscribe());
  }
}
