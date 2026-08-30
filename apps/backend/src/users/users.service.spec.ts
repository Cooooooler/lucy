import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { PasswordService } from '../password/password.service.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOneBy: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  };
  const passwordService = {
    hash: vi.fn().mockResolvedValue('hash'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: PasswordService, useValue: passwordService },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('create 用户名重复抛 409', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: '1' });
    await expect(
      service.create({ username: 'a', email: 'a@x.com', password: '12345678' }),
    ).rejects.toThrow(ConflictException);
  });

  it('create 成功时调用 hash 并 save', async () => {
    repo.findOneBy.mockResolvedValue(null);
    repo.save.mockResolvedValue({ id: '1' });
    await service.create({
      username: 'a',
      email: 'a@x.com',
      password: '12345678',
    });
    expect(passwordService.hash).toHaveBeenCalledWith('12345678');
    expect(repo.save).toHaveBeenCalled();
  });

  it('create 并发冲突命中唯一约束时按冲突列给出具体错误', async () => {
    repo.findOneBy.mockResolvedValue(null);
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (email)=(a@x.com) already exists.',
    });
    repo.save.mockRejectedValue(
      new QueryFailedError('INSERT INTO users', [], driverError),
    );
    await expect(
      service.create({
        username: 'a',
        email: 'a@x.com',
        password: '12345678',
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 409 },
    });
  });

  it('create 命中非 username/email 的唯一约束时向上传递原始错误', async () => {
    repo.findOneBy.mockResolvedValue(null);
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (phone)=(13800000000) already exists.',
    });
    const dbError = new QueryFailedError('INSERT INTO users', [], driverError);
    repo.save.mockRejectedValue(dbError);
    await expect(
      service.create({
        username: 'a',
        email: 'a@x.com',
        password: '12345678',
      }),
    ).rejects.toBe(dbError);
  });

  it('findByUsername 委托 repo', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    await expect(service.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ username: 'a' });
  });
});
