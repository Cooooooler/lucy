import { Test } from '@nestjs/testing';
import { User, UserRole } from './user.entity.js';
import { UsersRepository } from './users.repository.js';

describe('UsersRepository', () => {
  const qb = {
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getManyAndCount: vi.fn(),
  };
  const repo = {
    findOneBy: vi.fn(),
    findOne: vi.fn(),
    createQueryBuilder: vi.fn(() => qb),
    create: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };

  async function build(): Promise<UsersRepository> {
    const module = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: 'UserRepository', useValue: repo },
      ],
    })
      .overrideProvider(UsersRepository)
      .useValue(new UsersRepository(repo as never))
      .compile();
    return module.get(UsersRepository);
  }

  beforeEach(() => vi.clearAllMocks());

  it('findById 委托 findOneBy', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    const r = await build();
    await expect(r.findById('1')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ id: '1' });
  });

  it('findAccessById 仅查询 status 与 role 列', async () => {
    repo.findOne.mockResolvedValue({ status: 1, role: UserRole.Admin });
    const r = await build();
    await expect(r.findAccessById('1')).resolves.toEqual({
      status: 1,
      role: UserRole.Admin,
    });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: '1' },
      select: { status: true, role: true },
    });
  });

  it('findAccessById 用户不存在返回 null', async () => {
    repo.findOne.mockResolvedValue(null);
    const r = await build();
    await expect(r.findAccessById('1')).resolves.toBeNull();
  });

  it('findPage 分页且无过滤时不追加 where', async () => {
    qb.getManyAndCount.mockResolvedValue([[{ id: '1' }], 1]);
    const r = await build();
    await expect(r.findPage({ page: 2, pageSize: 10 })).resolves.toEqual([
      [{ id: '1' }],
      1,
    ]);
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('findPage 带 status 与 keyword 时追加过滤条件', async () => {
    qb.getManyAndCount.mockResolvedValue([[], 0]);
    const r = await build();
    await r.findPage({ page: 1, pageSize: 20, status: 0, keyword: 'a' });
    expect(qb.andWhere).toHaveBeenCalledWith('u.status = :status', {
      status: 0,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), {
      kw: '%a%',
    });
  });

  it('delete 委托底层 delete', async () => {
    const r = await build();
    await r.delete('1');
    expect(repo.delete).toHaveBeenCalledWith({ id: '1' });
  });

  it('findByUsername 委托 findOneBy', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    const r = await build();
    await expect(r.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ username: 'a' });
  });

  it('create 默认 role 为 user，save 透传底层仓储', async () => {
    const r = await build();
    repo.create.mockReturnValue({ id: '1' });
    repo.save.mockResolvedValue({ id: '1' });
    expect(
      r.create({
        username: 'a',
        email: 'a@x.com',
        passwordHash: 'h',
        status: 1,
      }),
    ).toEqual({
      id: '1',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.User }),
    );
    await expect(r.save({ id: '1' } as User)).resolves.toEqual({ id: '1' });
  });
});
