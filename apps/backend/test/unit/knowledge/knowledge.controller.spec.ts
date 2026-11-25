import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator.js';
import { KnowledgeDocumentService } from '@/knowledge/knowledge-document.service.js';
import { KnowledgeController } from '@/knowledge/knowledge.controller.js';
import { KnowledgeService } from '@/knowledge/knowledge.service.js';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * 控制器其余端点目前只在服务层有测试；HTTP 层的路由注册与参数校验依赖全局
 * `UUIDParam`（有单测）与 knowledge e2e。注意 like / unlike / removeDocument
 * 尚未进 e2e，是已知缺口。这里只保留控制器自己承担的校验分支：
 * 缺少上传文件字段时直接 400，不进入 service。
 */
describe('KnowledgeController.addDocument', () => {
  const user: CurrentUserPayload = { userId: 'u1', jti: 'j', role: 'user' };
  const documentService = { addDocument: vi.fn() };
  let controller: KnowledgeController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeService, useValue: {} },
        { provide: KnowledgeDocumentService, useValue: documentService },
      ],
    }).compile();
    controller = moduleRef.get(KnowledgeController);
  });

  it('缺少 file 时抛 BadRequestException，且不调用 service', () => {
    expect(() =>
      controller.addDocument(user, 'kb1', undefined as never),
    ).toThrow(BadRequestException);
    expect(documentService.addDocument).not.toHaveBeenCalled();
  });
});
