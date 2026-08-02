import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { PasswordService } from '../password/password.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const passwordService = {
    hash: jest.fn().mockResolvedValue('hash'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: PasswordService, useValue: passwordService },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('create 用户名重复抛 40901', async () => {
    repo.findOneBy.mockResolvedValueOnce({ id: '1' });
    await expect(
      service.create({ username: 'a', email: 'a@x.com', password: '12345678' }),
    ).rejects.toThrow(BusinessException);
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

  it('findByUsername 委托 repo', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    await expect(service.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ username: 'a' });
  });
});
