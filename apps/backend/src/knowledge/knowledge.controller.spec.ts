import { BadRequestException } from '@nestjs/common';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { KnowledgeController } from './knowledge.controller.js';

/**
 * 控制器其余端点都是把参数直接转交给 service（转发逻辑由 e2e 覆盖），
 * 这里只保留控制器自己承担的校验分支，避免每个方法各写一条
 * `toHaveBeenCalledWith` 的纯委托断言。
 */
describe('KnowledgeController.addDocument', () => {
  const user: CurrentUserPayload = { userId: 'u1', jti: 'j', role: 'user' };
  const documentService = { addDocument: vi.fn() };
  const controller = new KnowledgeController(
    {} as never,
    documentService as never,
  );

  it('缺少 file 时抛 BadRequestException，且不调用 service', () => {
    expect(() =>
      controller.addDocument(user, 'kb1', undefined as never),
    ).toThrow(BadRequestException);
    expect(documentService.addDocument).not.toHaveBeenCalled();
  });
});
