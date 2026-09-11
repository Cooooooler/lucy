import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostgresError } from 'pg-error-enum';
import { QueryFailedError } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { PasswordService } from '../password/password.service.js';
import { UserAccessService } from './user-access.service.js';
import { User } from './user.entity.js';
import { toSharedUser, type SharedUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly userAccess: UserAccessService,
    private readonly logger: AppLogger,
  ) {}

  /** 按用户名查询用户。 */
  findByUsername(username: string): Promise<User | null> {
    return this.usersRepo.findByUsername(username);
  }

  /** 按邮箱查询用户。 */
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findByEmail(email);
  }

  /** 按主键查询用户。 */
  findById(id: string): Promise<User | null> {
    return this.usersRepo.findById(id);
  }

  /** 创建用户（带唯一性校验与竞态兜底）。 */
  async create(input: {
    username: string;
    email: string;
    password: string;
    nickname?: string;
  }): Promise<User> {
    await this.assertUsernameAvailable(input.username);
    await this.assertEmailAvailable(input.email);
    const passwordHash = await this.passwordService.hash(input.password);
    const user = this.usersRepo.create({
      username: input.username,
      email: input.email,
      passwordHash,
      nickname: input.nickname ?? null,
      status: 1,
    });
    try {
      return await this.usersRepo.save(user);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw this.toUniqueConflict(err);
      }
      throw err;
    }
  }

  /** 分页查询用户（用户管理，仅 admin）。 */
  async list(query: {
    page?: number;
    pageSize?: number;
    status?: number;
    keyword?: string;
  }): Promise<{
    list: SharedUser[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [rows, total] = await this.usersRepo.findPage({
      page,
      pageSize,
      status: query.status,
      keyword: query.keyword,
    });
    return { list: rows.map(toSharedUser), total, page, pageSize };
  }

  /** 查询用户详情（用户管理，仅 admin）。 */
  async getDetail(id: string): Promise<SharedUser> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    return toSharedUser(user);
  }

  /** 启用/禁用用户（用户管理，仅 admin）；禁用后失效缓存，使其令牌立即不可用。 */
  async updateStatus(id: string, status: number): Promise<SharedUser> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status === status) return toSharedUser(user);
    user.status = status;
    const saved = await this.usersRepo.save(user);
    await this.userAccess.invalidate(id);
    this.logger.log(
      `user status update userId=${id} status=${status}`,
      UsersService.name,
    );
    return toSharedUser(saved);
  }

  /** 删除用户（用户管理，仅 admin）；关联数据由外键级联清理，并失效缓存。 */
  async remove(id: string): Promise<null> {
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    await this.usersRepo.delete(id);
    await this.userAccess.invalidate(id);
    this.logger.log(`user remove userId=${id}`, UsersService.name);
    return null;
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    if (await this.findByUsername(username)) {
      throw new ConflictException('用户名已存在');
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.findByEmail(email)) {
      throw new ConflictException('邮箱已存在');
    }
  }

  private isUniqueViolation(err: unknown): err is QueryFailedError {
    return (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string }).code ===
        PostgresError.UNIQUE_VIOLATION
    );
  }

  // 竞态兜底：预检查之外的并发写入触发唯一约束，解析冲突列给出具体提示
  // 兜底仅覆盖已识别的 username/email 约束；其他唯一约束视为未知错误向上传递，
  // 避免用 USERNAME_TAKEN 误导客户端。
  private toUniqueConflict(err: QueryFailedError): ConflictException {
    const detail = (err.driverError as { detail?: string }).detail ?? '';
    if (detail.includes('(email)')) {
      return new ConflictException('邮箱已存在');
    }
    if (detail.includes('(username)')) {
      return new ConflictException('用户名已存在');
    }
    throw err;
  }
}
