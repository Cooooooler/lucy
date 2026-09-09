import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgresError } from 'pg-error-enum';
import { QueryFailedError } from 'typeorm';
import { PasswordService } from '../password/password.service.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const usersRepo = {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn((u: unknown) => u),
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
        { provide: UsersRepository, useValue: usersRepo },
        { provide: PasswordService, useValue: passwordService },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('create 用户名重复抛 409', async () => {
    usersRepo.findByUsername.mockResolvedValueOnce({ id: '1' });
    await expect(
      service.create({ username: 'a', email: 'a@x.com', password: '12345678' }),
    ).rejects.toThrow(ConflictException);
  });

  it('create 成功时调用 hash 并 save', async () => {
    usersRepo.findByUsername.mockResolvedValue(null);
    usersRepo.findByEmail.mockResolvedValue(null);
    usersRepo.save.mockResolvedValue({ id: '1' });
    await service.create({
      username: 'a',
      email: 'a@x.com',
      password: '12345678',
    });
    expect(passwordService.hash).toHaveBeenCalledWith('12345678');
    expect(usersRepo.save).toHaveBeenCalled();
  });

  it('create 并发冲突命中唯一约束时按冲突列给出具体错误', async () => {
    usersRepo.findByUsername.mockResolvedValue(null);
    usersRepo.findByEmail.mockResolvedValue(null);
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: PostgresError.UNIQUE_VIOLATION,
      detail: 'Key (email)=(a@x.com) already exists.',
    });
    usersRepo.save.mockRejectedValue(
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
    usersRepo.findByUsername.mockResolvedValue(null);
    usersRepo.findByEmail.mockResolvedValue(null);
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: PostgresError.UNIQUE_VIOLATION,
      detail: 'Key (phone)=(13800000000) already exists.',
    });
    const dbError = new QueryFailedError('INSERT INTO users', [], driverError);
    usersRepo.save.mockRejectedValue(dbError);
    await expect(
      service.create({
        username: 'a',
        email: 'a@x.com',
        password: '12345678',
      }),
    ).rejects.toBe(dbError);
  });

  it('findByUsername 委托 UsersRepository', async () => {
    usersRepo.findByUsername.mockResolvedValue({ id: '1' });
    await expect(service.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(usersRepo.findByUsername).toHaveBeenCalledWith('a');
  });
});
