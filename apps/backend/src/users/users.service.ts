import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostgresError } from 'pg-error-enum';
import { QueryFailedError } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { PasswordService } from '../password/password.service.js';
import { UserAccessService } from './user-access.service.js';
import { roleRank, User } from './user.entity.js';
import { toSharedUser, type SharedUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';

/** 执行管理操作的操作者身份（来自 JWT 载荷，role 由 UserAccessService 缓存提供） */
export interface ActorContext {
  userId: string;
  role: string;
}

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

  /**
   * 启用/禁用用户（用户管理）；禁用后失效缓存，使其令牌立即不可用。
   * 仅可操作级别严格低于自己的账号（user < admin < superadmin）：
   * admin 只能动普通用户，superadmin 可动管理员；同级与上级一律拒绝，因此操作者
   * 关不掉自己，管理员集合也不会被同级互相清空，自锁在结构上不可能发生。
   */
  async updateStatus(
    actor: ActorContext,
    id: string,
    status: number,
  ): Promise<SharedUser> {
    if (actor.userId === id) {
      throw new ForbiddenException('不能修改自己的账号状态');
    }
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    this.assertOperable(actor.role, user);
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

  /**
   * 删除用户（用户管理）；关联数据由外键级联清理，并失效缓存。
   * 与启用/禁用同一层级限制：仅可删除级别严格低于自己的账号。
   */
  async remove(actor: ActorContext, id: string): Promise<null> {
    if (actor.userId === id) {
      throw new ForbiddenException('不能删除自己的账号');
    }
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    this.assertOperable(actor.role, user);
    await this.usersRepo.delete(id);
    await this.userAccess.invalidate(id);
    this.logger.log(`user remove userId=${id}`, UsersService.name);
    return null;
  }

  // 层级判定：仅允许操作严格下级；自身同级必然不满足，但上面已给出更明确的自我操作报错
  private assertOperable(actorRole: string, target: User): void {
    if (roleRank(actorRole) <= roleRank(target.role)) {
      throw new ForbiddenException('不能操作同级或更高级别的账号');
    }
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
