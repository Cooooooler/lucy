import { API_VERSION } from '@lucy/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
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
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import {
  DocumentListResultDto,
  KnowledgeBaseItemDto,
  KnowledgeDocumentDetailDto,
  KnowledgeListResultDto,
} from './dto/knowledge-list-result.dto.js';
import { LikeResultDto } from './dto/like-result.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { UpdateKnowledgeVisibilityDto } from './dto/update-knowledge-visibility.dto.js';
import { KnowledgeBaseVisibility } from './entities/knowledge-base.entity.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';
import { KnowledgeService } from './knowledge.service.js';

@ApiTags('knowledge')
@ApiBearerAuth()
// 知识库相关端点统一返回**允许式** DTO（KnowledgeBaseItemDto / KnowledgeListResultDto），
// 不再拿实体当契约：全局 ClassSerializerInterceptor 是排除式的，靠 @Exclude 兜底意味着
// 「实体新增字段默认出网」。实体的 `@Exclude()`（各实体仍保留）现在是第二道防线——
// 文档详情等仍直接返回实体，实体从任何控制器返回都受同一保护。
@Controller({ path: 'knowledge', version: API_VERSION })
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    // 文档端点走独立服务（上传解析/文件 I/O 与知识库元信息 CRUD 是两件事）
    private readonly documentService: KnowledgeDocumentService,
  ) {}

  @Post()
  @SuccessMessage('知识库创建成功')
  @ApiOperation({ summary: '创建知识库' })
  @ApiResponse({ status: 201, type: KnowledgeBaseItemDto })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: '知识库列表（游标分页）',
    description: '返回自己的 + 公开的；用响应中的 nextCursor 翻页',
  })
  @ApiResponse({ status: 200, type: KnowledgeListResultDto })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: KnowledgeListQueryDto,
  ): Promise<KnowledgeListResultDto> {
    return this.knowledgeService.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '知识库详情' })
  @ApiResponse({ status: 200, type: KnowledgeBaseItemDto })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.get(user.userId, id);
  }

  @Patch(':id')
  // 整表单更新（含编辑抽屉里顺带改可见性）统一提示「知识库更新成功」：
  // 单纯的可见性切换走下面的独立端点，文案不再靠请求体形状反推
  @SuccessMessage('知识库更新成功')
  @ApiOperation({ summary: '更新知识库' })
  @ApiResponse({ status: 200, type: KnowledgeBaseItemDto })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.update(user.userId, id, dto);
  }

  @Patch(':id/visibility')
  // 可见性切换独立成端点：成功文案依据响应里的 visibility（服务端事实），
  // 而不是「请求体是否只有 visibility 一个键」这类形状启发式。
  // 解析器在字段缺失/未知值时抛错，由 ApiResponseInterceptor 记 warn 后回退
  // 方法级兜底（「更新成功」），契约漂移不会静默，也不会给出与事实相反的文案。
  @SuccessMessage((data) => {
    const visibility = (data as KnowledgeBaseItemDto | null)?.visibility;
    if (visibility === KnowledgeBaseVisibility.Public) return '已设为公开';
    if (visibility === KnowledgeBaseVisibility.Private) return '已设为私有';
    throw new Error(
      `updateVisibility 响应缺少 visibility：${String(visibility)}`,
    );
  })
  @ApiOperation({ summary: '切换知识库可见性' })
  @ApiResponse({ status: 200, type: KnowledgeBaseItemDto })
  @ApiResponse({ status: 403, description: '仅知识库主可操作' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  updateVisibility(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('id') id: string,
    @Body() dto: UpdateKnowledgeVisibilityDto,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.update(user.userId, id, {
      visibility: dto.visibility,
    });
  }

  @Delete(':id')
  @SuccessMessage('知识库已删除')
  @ApiOperation({ summary: '删除知识库（级联清文档与文件）' })
  remove(@CurrentUser() user: CurrentUserPayload, @UUIDParam('id') id: string) {
    return this.knowledgeService.remove(user.userId, id);
  }

  @Post(':id/like')
  @SuccessMessage('点赞成功')
  @ApiOperation({ summary: '点赞知识库' })
  @ApiResponse({ status: 200, type: LikeResultDto })
  like(@CurrentUser() user: CurrentUserPayload, @UUIDParam('id') id: string) {
    return this.knowledgeService.like(user.userId, id);
  }

  @Delete(':id/like')
  @SuccessMessage('已取消点赞')
  @ApiOperation({ summary: '取消点赞知识库' })
  @ApiResponse({ status: 200, type: LikeResultDto })
  unlike(@CurrentUser() user: CurrentUserPayload, @UUIDParam('id') id: string) {
    return this.knowledgeService.unlike(user.userId, id);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    // 10MB 为此处 FileInterceptor 内存缓冲的 DoS 安全硬顶；FILE_MAX_SIZE（本服务）为次级校验，
    // 有效上限取两者较小值——运维即便把 FILE_MAX_SIZE 调超 10MB，也会先被此硬顶拦截。
    // defParamCharset：multer 默认按 latin1 解 multipart 头参数，浏览器发的 UTF-8 中文文件名
    // 会解成乱码（originalname 与落库的 originalName/title 一起坏掉）。
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      defParamCharset: 'utf8',
    }),
  )
  @ApiConsumes('multipart/form-data')
  @SuccessMessage('文档上传成功')
  @ApiOperation({
    summary: '上传文档',
    description: 'multipart/form-data，字段名 file',
  })
  @ApiResponse({ status: 201, type: KnowledgeDocumentDetailDto })
  addDocument(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('kbId') kbId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KnowledgeDocumentDetailDto> {
    if (!file) throw new BadRequestException('缺少文件字段 file');
    return this.documentService.addDocument(user.userId, kbId, file);
  }

  @Get(':kbId/documents')
  @ApiOperation({
    summary: '某知识库文档列表（页码分页）',
    description:
      '用 page/pageSize 翻页，响应含 total（总条数）与本页页码；' +
      '旧的 cursor/limit 已随页码分页改造移除，照旧文档发送会被全局校验管道拒为 400。',
  })
  @ApiResponse({ status: 200, type: DocumentListResultDto })
  listDocuments(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('kbId') kbId: string,
    @Query() query: DocumentListQueryDto,
  ): Promise<DocumentListResultDto> {
    return this.documentService.listDocuments(user.userId, kbId, query);
  }

  @Get(':kbId/documents/:id')
  @ApiOperation({ summary: '文档详情（含解析文本）' })
  @ApiResponse({ status: 200, type: KnowledgeDocumentDetailDto })
  getDocument(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('kbId') kbId: string,
    @UUIDParam('id') id: string,
  ): Promise<KnowledgeDocumentDetailDto> {
    return this.documentService.getDocument(user.userId, kbId, id);
  }

  @Delete(':kbId/documents/:id')
  @SuccessMessage('文档已删除')
  @ApiOperation({ summary: '删除文档（连带清理文件）' })
  removeDocument(
    @CurrentUser() user: CurrentUserPayload,
    @UUIDParam('kbId') kbId: string,
    @UUIDParam('id') id: string,
  ) {
    return this.documentService.removeDocument(user.userId, kbId, id);
  }
}
