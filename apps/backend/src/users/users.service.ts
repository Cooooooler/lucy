import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception';
import { PasswordService } from '../password/password.service';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly passwordService: PasswordService,
  ) {}

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOneBy({ username });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  async create(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<User> {
    if (await this.findByUsername(input.username)) {
      throw new BusinessException(
        ErrorCode.USERNAME_TAKEN,
        '用户名已存在',
        HttpStatus.CONFLICT,
      );
    }
    if (await this.findByEmail(input.email)) {
      throw new BusinessException(
        ErrorCode.EMAIL_TAKEN,
        '邮箱已存在',
        HttpStatus.CONFLICT,
      );
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
        throw new BusinessException(
          ErrorCode.USERNAME_TAKEN,
          '用户名或邮箱已存在',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
