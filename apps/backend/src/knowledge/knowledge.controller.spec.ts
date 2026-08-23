import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  const service = {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addDocument: vi.fn(),
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
    removeDocument: vi.fn(),
  };

  const user: CurrentUserPayload = { userId: 'u1', jti: 'j' };

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: service }],
    }).compile();
    controller = moduleRef.get(KnowledgeController);
  });

  it('create 转发到 service', async () => {
    const dto = { name: 'x', description: 'd' };
    await controller.create(user, dto);
    expect(service.create).toHaveBeenCalledWith('u1', dto);
  });

  it('list 转发 userId 与 query', async () => {
    const query = { page: 2, pageSize: 10, name: 'x' };
    await controller.list(user, query);
    expect(service.list).toHaveBeenCalledWith('u1', query);
  });

  it('get 转发 userId 与 id', async () => {
    await controller.get(user, 'kb1');
    expect(service.get).toHaveBeenCalledWith('u1', 'kb1');
  });

  it('update 转发 userId、id、dto', async () => {
    const dto = { name: 'y' };
    await controller.update(user, 'kb1', dto);
    expect(service.update).toHaveBeenCalledWith('u1', 'kb1', dto);
  });

  it('remove 转发 userId 与 id', async () => {
    await controller.remove(user, 'kb1');
    expect(service.remove).toHaveBeenCalledWith('u1', 'kb1');
  });

  it('addDocument 转发 userId、kbId、file', async () => {
    const file = { originalname: 'a.pdf' } as Express.Multer.File;
    await controller.addDocument(user, 'kb1', file);
    expect(service.addDocument).toHaveBeenCalledWith('u1', 'kb1', file);
  });

  it('addDocument 缺 file 抛 BadRequestException', () => {
    expect(() =>
      controller.addDocument(user, 'kb1', undefined as never),
    ).toThrow(BadRequestException);
    expect(service.addDocument).not.toHaveBeenCalled();
  });

  it('listDocuments 转发 userId、kbId、query', async () => {
    const query = { keyword: 'x' };
    await controller.listDocuments(user, 'kb1', query);
    expect(service.listDocuments).toHaveBeenCalledWith('u1', 'kb1', query);
  });

  it('getDocument 转发 userId、kbId、id', async () => {
    await controller.getDocument(user, 'kb1', 'd1');
    expect(service.getDocument).toHaveBeenCalledWith('u1', 'kb1', 'd1');
  });

  it('removeDocument 转发 userId、kbId、id', async () => {
    await controller.removeDocument(user, 'kb1', 'd1');
    expect(service.removeDocument).toHaveBeenCalledWith('u1', 'kb1', 'd1');
  });
});
