import { ErrorCode } from '@lucy/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BusinessException } from '../common/exceptions/business.exception.js';
import { PasswordService } from '../password/password.service.js';
import { User } from './user.entity.js';

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
    await this.assertUsernameAvailable(input.username);
    await this.assertEmailAvailable(input.email);
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
      if (this.isUniqueViolation(err)) {
        throw this.toUniqueConflict(err);
      }
      throw err;
    }
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    if (await this.findByUsername(username)) {
      throw new BusinessException(
        ErrorCode.USERNAME_TAKEN,
        '用户名已存在',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.findByEmail(email)) {
      throw new BusinessException(
        ErrorCode.EMAIL_TAKEN,
        '邮箱已存在',
        HttpStatus.CONFLICT,
      );
    }
  }

  private isUniqueViolation(err: unknown): err is QueryFailedError {
    return (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string }).code === '23505'
    );
  }

  // 竞态兜底：预检查之外的并发写入触发唯一约束，解析冲突列给出具体提示
  // 兜底仅覆盖已识别的 username/email 约束；其他唯一约束视为未知错误向上传递，
  // 避免用 USERNAME_TAKEN 误导客户端。
  private toUniqueConflict(err: QueryFailedError): BusinessException {
    const detail = (err.driverError as { detail?: string }).detail ?? '';
    if (detail.includes('(email)')) {
      return new BusinessException(
        ErrorCode.EMAIL_TAKEN,
        '邮箱已存在',
        HttpStatus.CONFLICT,
      );
    }
    if (detail.includes('(username)')) {
      return new BusinessException(
        ErrorCode.USERNAME_TAKEN,
        '用户名已存在',
        HttpStatus.CONFLICT,
      );
    }
    throw err;
  }
}
