import type {
  KnowledgeDocument,
  KnowledgeDocumentListItem,
  User,
} from '../api/types';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    username: 'alice',
    email: 'alice@example.com',
    nickname: null,
    status: 1,
    role: 'user',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * 文档**详情/上传**响应（`KnowledgeDocumentDetailDto`，含解析全文 `content`）。
 * 与列表项工厂同文件：两者的字段集只差一个 `content`，拆两处就会各自漂移
 * （契约里那份「详情 = 列表 + content」的不变量在测试侧也要看得见）。
 */
export function makeDocument(
  overrides: Partial<KnowledgeDocument> = {},
): KnowledgeDocument {
  return {
    id: 'd1',
    knowledgeBaseId: 'kb1',
    fileId: 'f1',
    title: 'intro',
    originalName: 'intro.md',
    ext: '.md',
    mime: 'text/markdown',
    size: 1024,
    content: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** 文档**列表项**（`KnowledgeDocumentListItemDto`）：刻意不含 `content`（服务端做列投影） */
export function makeDocumentListItem(
  overrides: Partial<KnowledgeDocumentListItem> = {},
): KnowledgeDocumentListItem {
  const { content: _content, ...listItem } = makeDocument(overrides);
  return listItem;
}
