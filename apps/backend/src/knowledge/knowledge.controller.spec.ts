import { Test } from '@nestjs/testing';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  const service = { create: vi.fn().mockResolvedValue({}) };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: service }],
    }).compile();
    controller = moduleRef.get(KnowledgeController);
  });

  it('create 转发到 service', async () => {
    await controller.create({ userId: 'u1', jti: 'j' }, { name: 'x' });
    expect(service.create).toHaveBeenCalledWith('u1', { name: 'x' });
  });
});
