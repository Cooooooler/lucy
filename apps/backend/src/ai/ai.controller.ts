import { API_VERSION } from '@lucy/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { Subscription } from 'rxjs';
import { AppLogger } from '../common/app-logger.service.js';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { SuccessMessage } from '../common/decorators/success-message.decorator.js';
import { CursorQueryDto } from '../common/pagination/dto/cursor-query.dto.js';
import { UUIDParam } from '../common/pipes/uuid-param.js';
import { SSE_METADATA } from '../common/sse-metadata.js';
import { AiService } from './ai.service.js';
import { ChatStreamService } from './chat-stream.service.js';
import { ConversationDetailDto } from './dto/conversation-detail.dto.js';
import { ConversationItemDto } from './dto/conversation-item.dto.js';
import { ConversationListResultDto } from './dto/conversation-list-result.dto.js';
import { RenameConversationDto } from './dto/rename-conversation.dto.js';
import { SendMessageDto } from './dto/send-message.dto.js';

@ApiTags('ai')
@ApiBearerAuth()
@Controller({ path: 'ai', version: API_VERSION })
export class AiController {
  constructor(
    private readonly aiService: AiService,
    // SSE 端点走独立的流式服务（会话 CRUD 与「流式生成 + 中断/超时 + 落库状态机」是两件事）
    private readonly chatStream: ChatStreamService,
    private readonly logger: AppLogger,
  ) {}

  @Post('conversations')
  @SuccessMessage('会话创建成功')
  @ApiOperation({ summary: '创建会话', description: '新建一个 AI 对话会话' })
  @ApiResponse({
    status: 201,
    description: '创建成功',
    type: ConversationItemDto,
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ConversationItemDto> {
    return this.aiService.create(user.userId);
  }

  @Get('conversations')
  @ApiOperation({
    summary: '会话列表',
    description:
      '按最近活跃倒序，游标分页。排序键是**可变列** updatedAt：翻页期间被更新的会话会被移到 ' +
      '游标之前，本轮翻页取不到（不会重复，但需刷新或重拉首页才会出现）——客户端在写操作' +
      '（发消息/改名）后应重置到首页。nextCursor 为 null 即末页（list 为空只能是' +
      '「游标之后的行被更新/删除」的兜底情形，满页的末页不会给出下一次游标）',
  })
  @ApiResponse({
    status: 200,
    description: '返回分页会话列表',
    type: ConversationListResultDto,
  })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: CursorQueryDto,
  ) {
    // 分页入参原样透传：默认值与边界策略由 KeysetPaginator 归一化，避免两处各有一份默认值
    return this.aiService.list(user.userId, query.cursor, query.limit);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '会话详情', description: '含消息列表（时间正序）' })
  @ApiResponse({
    status: 200,
    description: '返回会话及消息',
    type: ConversationDetailDto,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
  ): Promise<ConversationDetailDto> {
    return this.aiService.get(user.userId, id);
  }

  @Patch('conversations/:id')
  @SuccessMessage('会话已重命名')
  @ApiOperation({ summary: '改名', description: '修改会话标题' })
  @ApiResponse({
    status: 200,
    description: '返回更新后会话',
    type: ConversationItemDto,
  })
  @ApiResponse({ status: 404, description: '会话不存在' })
  rename(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
    @Body() dto: RenameConversationDto,
  ): Promise<ConversationItemDto> {
    return this.aiService.rename(user.userId, id, dto.title);
  }

  @Delete('conversations/:id')
  @SuccessMessage('会话已删除')
  @ApiOperation({ summary: '删除会话', description: '级联删除该会话全部消息' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '会话不存在' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
  ): Promise<null> {
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
    @UUIDParam('id') id: string,
    @Body() dto: SendMessageDto,
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 本响应是否已经收尾。不只看 writableEnded/destroyed：end() 抛错时 writableEnded
    // 不会置位，靠这个本地标记保证只收尾一次。
    let closed = false;
    const isClosed = (): boolean =>
      closed || res.destroyed || res.writableEnded;
    const logStreamError = (message: string, err: unknown): void => {
      this.logger.error(
        `SSE ${message} conversation=${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
        AiController.name,
      );
    };
    const closeResponse = (): void => {
      if (isClosed()) {
        return;
      }
      closed = true;
      try {
        res.end();
      } catch (err) {
        logStreamError('关闭响应失败', err);
      }
    };

    // 用 Subscription 容器承接内层订阅：写帧失败时可能在 subscribe() 返回前就要退订
    // （同步数据源），直接引用返回值会拿不到。
    const subscription = new Subscription();
    // 写帧统一走这里：res.write 在客户端断开后可能同步抛错。RxJS 对 next/complete
    // 回调里抛出的异常不会交给下面的 error 回调，而是经 handleUnhandledError 异步
    // 重抛到宿主事件循环（最终命中 main.ts 的 uncaughtException → process.exit(1)）。
    // 所以这里就地兜住，失败即记日志、退订并尽力关闭响应，让写失败止步于单条连接。
    const writeFrame = (chunk: string): void => {
      if (isClosed()) {
        return;
      }
      try {
        res.write(chunk);
      } catch (err) {
        logStreamError('写帧失败', err);
        subscription.unsubscribe();
        closeResponse();
      }
    };

    subscription.add(
      this.chatStream.sendMessage(user.userId, id, dto).subscribe({
        next: (event) => writeFrame(`data: ${JSON.stringify(event)}\n\n`),
        complete: () => {
          writeFrame('data: [DONE]\n\n');
          closeResponse();
        },
        // 必须显式处理：RxJS 在订阅缺省 error 回调时会把错误 rethrow 到宿主环境，
        // 那个异常落在事件循环里、不属于任何请求上下文，会撞上 main.ts 的
        // `uncaughtException` → `process.exit(1)`，把单条流的故障放大成整进程退出。
        // 走到这里的是源发出的 error 通知；写帧本身的异常由上面的 writeFrame 兜住。
        error: (err: unknown) => {
          logStreamError('流异常终止', err);
          closeResponse();
        },
      }),
    );
    // 客户端断开时取消订阅，触发 service 的 AbortController 中断模型流
    res.on('close', () => subscription.unsubscribe());
  }
}
