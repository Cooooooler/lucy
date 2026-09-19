import type {
  KnowledgeBaseItemDto,
  KnowledgeDocumentListItemDto,
} from './dto/knowledge-list-result.dto.js';
import type { KnowledgeBase } from './entities/knowledge-base.entity.js';
import type { KnowledgeDocument } from './entities/knowledge-document.entity.js';

/**
 * 把知识库实体映射为对外契约视图（允许式白名单）。
 *
 * `likeCount`/`isLiked` 是查询期计算的视图字段（见 `KnowledgeService.fillLikeInfo`），
 * 服务层保证返回前已填充；未填充时按「无点赞」兜底，保证所有端点的响应形状一致。
 */
export function toKnowledgeBaseItem(kb: KnowledgeBase): KnowledgeBaseItemDto {
  const { id, ownerId, visibility, name, description, createdAt, updatedAt } =
    kb;
  return {
    id,
    ownerId,
    visibility,
    name,
    description,
    createdAt,
    updatedAt,
    likeCount: kb.likeCount ?? 0,
    isLiked: kb.isLiked ?? false,
  };
}

/**
 * 把文档实体映射为列表项视图（允许式白名单）。
 *
 * 刻意不返回 `content`（解析出的全文，可达 MB 级）——它只随详情接口出网。
 * 配合 `KnowledgeService.listDocuments` 的列投影，两个层面都不把全文带进列表：
 * 数据库不读、响应也不带。
 */
export function toDocumentListItem(
  doc: KnowledgeDocument,
): KnowledgeDocumentListItemDto {
  const { id, knowledgeBaseId, fileId, title, createdAt, updatedAt } = doc;
  return { id, knowledgeBaseId, fileId, title, createdAt, updatedAt };
}
