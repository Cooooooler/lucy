import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { PasswordService } from '../password/password.service.js';
import { User } from './user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly passwordService: PasswordService,
  ) {}

  /** 按用户名查询用户。 */
  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOneBy({ username });
  }

  /** 按邮箱查询用户。 */
  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  /** 按主键查询用户。 */
  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  /** 创建用户（带唯一性校验与竞态兜底）。 */
  async create(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<User> {
    if (await this.findByUsername(input.username)) {
      throw new ConflictException('用户名已存在');
    }
    if (await this.findByEmail(input.email)) {
      throw new ConflictException('邮箱已存在');
    }
    const passwordHash = await this.passwordService.hash(input.password);
    const user = this.repo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      nickname: input.nickname ?? null,
      status: 1,
    });
    try {
      return await this.repo.save(user);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === '23505'
      ) {
        // 竞态兜底：预检查之外的并发写入触发唯一约束，解析冲突列给出具体提示
        const detail = (err.driverError as { detail?: string }).detail ?? '';
        const isEmail = detail.includes('(email)');
        const isUsername = detail.includes('(username)');
        throw new ConflictException(
          isEmail
            ? '邮箱已存在'
            : isUsername
              ? '用户名已存在'
              : '用户名或邮箱已存在',
        );
      }
      throw err;
    }
  }
}
