import { API_VERSION } from '@lucy/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { KnowledgeService } from './knowledge.service.js';

@ApiTags('knowledge')
@ApiBearerAuth()
// 知识库相关端点统一返回**允许式** DTO（KnowledgeBaseItemDto / KnowledgeListResultDto），
// 不再拿实体当契约：全局 ClassSerializerInterceptor 是排除式的，靠 @Exclude 兜底意味着
// 「实体新增字段默认出网」。实体的 `@Exclude()`（各实体仍保留）现在是第二道防线——
// 文档详情等仍直接返回实体，实体从任何控制器返回都受同一保护。
@Controller({ path: 'knowledge', version: API_VERSION })
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

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
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.get(user.userId, id);
  }

  @Patch(':id')
  // 可见性单独切换与整表单编辑走同一接口：只改 visibility 时给「已设为公开/私有」，
  // 其他字段的更新给「知识库更新成功」。判请求体而非响应体——幂等重复提交也能给对文案。
  // express 的 req.body 类型为 any：先收窄成可选字段对象再读，避免 any 污染。
  @SuccessMessage((_data, req) => {
    const body = req.body as { visibility?: unknown } | undefined;
    return body?.visibility === 'public'
      ? '已设为公开'
      : body?.visibility === 'private'
        ? '已设为私有'
        : '知识库更新成功';
  })
  @ApiOperation({ summary: '更新知识库' })
  @ApiResponse({ status: 200, type: KnowledgeBaseItemDto })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseItemDto> {
    return this.knowledgeService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @SuccessMessage('知识库已删除')
  @ApiOperation({ summary: '删除知识库（级联清文档与文件）' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.remove(user.userId, id);
  }

  @Post(':id/like')
  @SuccessMessage('点赞成功')
  @ApiOperation({ summary: '点赞知识库' })
  @ApiResponse({ status: 200, type: LikeResultDto })
  like(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.like(user.userId, id);
  }

  @Delete(':id/like')
  @SuccessMessage('已取消点赞')
  @ApiOperation({ summary: '取消点赞知识库' })
  @ApiResponse({ status: 200, type: LikeResultDto })
  unlike(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.unlike(user.userId, id);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    // 10MB 为此处 FileInterceptor 内存缓冲的 DoS 安全硬顶；FILE_MAX_SIZE（本服务）为次级校验，
    // 有效上限取两者较小值——运维即便把 FILE_MAX_SIZE 调超 10MB，也会先被此硬顶拦截。
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
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
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KnowledgeDocumentDetailDto> {
    if (!file) throw new BadRequestException('缺少文件字段 file');
    return this.knowledgeService.addDocument(user.userId, kbId, file);
  }

  @Get(':kbId/documents')
  @ApiOperation({ summary: '某知识库文档列表（游标分页）' })
  @ApiResponse({ status: 200, type: DocumentListResultDto })
  listDocuments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: DocumentListQueryDto,
  ): Promise<DocumentListResultDto> {
    return this.knowledgeService.listDocuments(user.userId, kbId, query);
  }

  @Get(':kbId/documents/:id')
  @ApiOperation({ summary: '文档详情（含解析文本）' })
  @ApiResponse({ status: 200, type: KnowledgeDocumentDetailDto })
  getDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDocumentDetailDto> {
    return this.knowledgeService.getDocument(user.userId, kbId, id);
  }

  @Delete(':kbId/documents/:id')
  @SuccessMessage('文档已删除')
  @ApiOperation({ summary: '删除文档（连带清理文件）' })
  removeDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.removeDocument(user.userId, kbId, id);
  }
}
