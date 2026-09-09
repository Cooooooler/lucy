import { Test } from '@nestjs/testing';
import { User } from './user.entity.js';
import { UsersRepository } from './users.repository.js';

describe('UsersRepository', () => {
  const repo = {
    findOneBy: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
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

  it('findByUsername 委托 findOneBy', async () => {
    repo.findOneBy.mockResolvedValue({ id: '1' });
    const r = await build();
    await expect(r.findByUsername('a')).resolves.toEqual({ id: '1' });
    expect(repo.findOneBy).toHaveBeenCalledWith({ username: 'a' });
  });

  it('create/save 透传底层仓储', async () => {
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
    await expect(r.save({ id: '1' } as User)).resolves.toEqual({ id: '1' });
  });
});
