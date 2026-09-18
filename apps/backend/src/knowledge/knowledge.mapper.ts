import type { KnowledgeDocumentListItemDto } from './dto/knowledge-list-result.dto.js';
import type { KnowledgeDocument } from './entities/knowledge-document.entity.js';

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
