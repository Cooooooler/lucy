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
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { DocumentListQueryDto } from './dto/document-list-query.dto.js';
import { KnowledgeListQueryDto } from './dto/knowledge-list-query.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { KnowledgeBase } from './entities/knowledge-base.entity.js';
import { KnowledgeDocument } from './entities/knowledge-document.entity.js';
import { KnowledgeService } from './knowledge.service.js';

@ApiTags('knowledge')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  @ApiOperation({ summary: '创建知识库' })
  @ApiResponse({ status: 201, type: KnowledgeBase })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBase> {
    return this.knowledgeService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '知识库列表', description: '返回自己的 + 公开的' })
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: KnowledgeListQueryDto,
  ) {
    return this.knowledgeService.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '知识库详情' })
  @ApiResponse({ status: 404, description: '知识库不存在' })
  get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.get(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新知识库' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除知识库（级联清文档与文件）' })
  remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.remove(user.userId, id);
  }

  @Post(':kbId/documents')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '上传文档',
    description: 'multipart/form-data，字段名 file',
  })
  addDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<KnowledgeDocument> {
    if (!file) throw new BadRequestException('缺少文件字段 file');
    return this.knowledgeService.addDocument(user.userId, kbId, file);
  }

  @Get(':kbId/documents')
  @ApiOperation({ summary: '某知识库文档列表' })
  listDocuments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Query() query: DocumentListQueryDto,
  ) {
    return this.knowledgeService.listDocuments(user.userId, kbId, query);
  }

  @Get(':kbId/documents/:id')
  @ApiOperation({ summary: '文档详情（含解析文本）' })
  getDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.getDocument(user.userId, kbId, id);
  }

  @Delete(':kbId/documents/:id')
  @ApiOperation({ summary: '删除文档（连带清理文件）' })
  removeDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('kbId', ParseUUIDPipe) kbId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.removeDocument(user.userId, kbId, id);
  }
}
