import type {
  KnowledgeBaseItemDto,
  KnowledgeDocumentDetailDto,
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

/** 文档契约里的文件元信息（来自 `files` 表） */
type DocumentFileMeta = {
  originalName: string;
  ext: string;
  mime: string;
  size: number;
};

/**
 * 从已加载的 `file` 关系取文件元信息。
 *
 * ⚠️ 调用方必须保证 `file` 关系已加载，否则这四个字段会静默变成空值/0：
 * - 列表：`listDocuments` 用 `innerJoin('d.file', 'f')` + `addSelect`（`file_id` 是 NOT NULL 外键，内连接不会丢行）
 * - 详情：`getDocument` 用 `relations: { file: true }`
 * - 上传：`addDocument` 把刚保存的 file 实体回填到返回对象上
 * 三条路径在 service 用例里都有断言钉住，漏加载时测试会红，而不是悄悄给前端一个空文件名。
 */
function fileMetaOf(doc: KnowledgeDocument): DocumentFileMeta {
  return {
    originalName: doc.file?.originalName ?? '',
    ext: doc.file?.ext ?? '',
    mime: doc.file?.mime ?? '',
    size: doc.file?.size ?? 0,
  };
}

/**
 * 把文档实体映射为列表项视图（允许式白名单）。
 *
 * 刻意不返回 `content`（解析出的全文，可达 MB 级）——它只随详情接口出网。
 * 配合 `KnowledgeDocumentService.listDocuments` 的列投影，两个层面都不把全文带进列表：
 * 数据库不读、响应也不带。
 */
export function toDocumentListItem(
  doc: KnowledgeDocument,
): KnowledgeDocumentListItemDto {
  const { id, knowledgeBaseId, fileId, title, createdAt, updatedAt } = doc;
  return {
    id,
    knowledgeBaseId,
    fileId,
    title,
    ...fileMetaOf(doc),
    createdAt,
    updatedAt,
  };
}

/**
 * 把文档实体映射为详情契约视图（允许式白名单，**含** `content` 解析全文）。
 * 详情与上传共用同一形状，前端两处拿到的类型一致。
 */
export function toDocumentDetail(
  doc: KnowledgeDocument,
): KnowledgeDocumentDetailDto {
  const { id, knowledgeBaseId, fileId, title, content, createdAt, updatedAt } =
    doc;
  return {
    id,
    knowledgeBaseId,
    fileId,
    title,
    ...fileMetaOf(doc),
    content,
    createdAt,
    updatedAt,
  };
}
