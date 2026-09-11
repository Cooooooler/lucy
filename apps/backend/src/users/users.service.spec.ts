import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgresError } from 'pg-error-enum';
import { QueryFailedError } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { PasswordService } from '../password/password.service.js';
import { UserAccessService } from './user-access.service.js';
import { User, UserRole } from './user.entity.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  let service: UsersService;
  const usersRepo = {
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findPage: vi.fn(),
    delete: vi.fn(),
    create: vi.fn((u: unknown) => u),
    save: vi.fn(),
  };
  const passwordService = {
    hash: vi.fn().mockResolvedValue('hash'),
  };
  const userAccess = { invalidate: vi.fn() };
  const logger = { log: vi.fn() };

  const user: User = {
    id: 'u1',
    username: 'alice',
    email: 'alice@x.com',
    passwordHash: 'hash',
    nickname: null,
    status: 1,
    role: UserRole.User,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: usersRepo },
        { provide: PasswordService, useValue: passwordService },
        { provide: UserAccessService, useValue: userAccess },
        { provide: AppLogger, useValue: logger },
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

  it('list 应用默认分页并返回剔除敏感字段的契约视图', async () => {
    usersRepo.findPage.mockResolvedValue([[user], 1]);
    const result = await service.list({});
    expect(usersRepo.findPage).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: undefined,
      keyword: undefined,
    });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.list[0]).toEqual(
      expect.objectContaining({ id: 'u1', role: UserRole.User }),
    );
    expect(result.list[0]).not.toHaveProperty('passwordHash');
  });

  it('getDetail 用户不存在抛 404', async () => {
    usersRepo.findById.mockResolvedValue(null);
    await expect(service.getDetail('x')).rejects.toThrow(NotFoundException);
  });

  it('getDetail 返回契约视图', async () => {
    usersRepo.findById.mockResolvedValue(user);
    await expect(service.getDetail('u1')).resolves.toEqual(
      expect.objectContaining({ id: 'u1', email: 'alice@x.com' }),
    );
  });

  it('updateStatus 变更时保存并失效缓存', async () => {
    usersRepo.findById.mockResolvedValue({ ...user });
    usersRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    const result = await service.updateStatus('admin1', 'u1', 0);
    expect(usersRepo.save).toHaveBeenCalled();
    expect(userAccess.invalidate).toHaveBeenCalledWith('u1');
    expect(result.status).toBe(0);
    expect(logger.log).toHaveBeenCalled();
  });

  it('updateStatus 状态相同时不保存、不失效缓存', async () => {
    usersRepo.findById.mockResolvedValue({ ...user });
    const result = await service.updateStatus('admin1', 'u1', 1);
    expect(usersRepo.save).not.toHaveBeenCalled();
    expect(userAccess.invalidate).not.toHaveBeenCalled();
    expect(result.status).toBe(1);
  });

  it('updateStatus 用户不存在抛 404', async () => {
    usersRepo.findById.mockResolvedValue(null);
    await expect(service.updateStatus('admin1', 'x', 0)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updateStatus 操作自己抛 403 且不触达仓储', async () => {
    await expect(service.updateStatus('u1', 'u1', 0)).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepo.findById).not.toHaveBeenCalled();
    expect(usersRepo.save).not.toHaveBeenCalled();
  });

  it('updateStatus 目标是其他管理员时抛 403 且不保存', async () => {
    usersRepo.findById.mockResolvedValue({ ...user, role: UserRole.Admin });
    await expect(service.updateStatus('admin1', 'u1', 0)).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepo.save).not.toHaveBeenCalled();
    expect(userAccess.invalidate).not.toHaveBeenCalled();
  });

  it('remove 删除用户并失效缓存', async () => {
    usersRepo.findById.mockResolvedValue(user);
    await expect(service.remove('admin1', 'u1')).resolves.toBeNull();
    expect(usersRepo.delete).toHaveBeenCalledWith('u1');
    expect(userAccess.invalidate).toHaveBeenCalledWith('u1');
  });

  it('remove 用户不存在抛 404 且不删除', async () => {
    usersRepo.findById.mockResolvedValue(null);
    await expect(service.remove('admin1', 'x')).rejects.toThrow(
      NotFoundException,
    );
    expect(usersRepo.delete).not.toHaveBeenCalled();
  });

  it('remove 删除自己抛 403 且不触达仓储', async () => {
    await expect(service.remove('u1', 'u1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepo.findById).not.toHaveBeenCalled();
    expect(usersRepo.delete).not.toHaveBeenCalled();
  });

  it('remove 目标是其他管理员时抛 403 且不删除', async () => {
    usersRepo.findById.mockResolvedValue({ ...user, role: UserRole.Admin });
    await expect(service.remove('admin1', 'u1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersRepo.delete).not.toHaveBeenCalled();
    expect(userAccess.invalidate).not.toHaveBeenCalled();
  });
});
