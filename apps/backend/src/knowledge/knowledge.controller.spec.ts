import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { KnowledgeDocumentService } from './knowledge-document.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * 控制器其余端点都是把参数直接转交给 service（转发行为由 e2e 覆盖），
 * 这里只保留控制器自己承担的校验分支：缺少上传文件字段时直接 400，不进入 service。
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
