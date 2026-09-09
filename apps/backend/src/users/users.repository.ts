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
