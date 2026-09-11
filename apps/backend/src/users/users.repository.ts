import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  /** 仅查询 status 列，供每请求认证校验的用户可用性检查使用（避免拉取整行）。 */
  async findStatusById(id: string): Promise<number | null> {
    const user = await this.repo.findOne({
      where: { id },
      select: { status: true },
    });
    return user?.status ?? null;
  }

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOneBy({ username });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  create(input: {
    username: string;
    email: string;
    passwordHash: string;
    nickname?: string | null;
    status: number;
  }): User {
    return this.repo.create({
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      nickname: input.nickname ?? null,
      status: input.status,
    });
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }
}
