import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostgresError } from 'pg-error-enum';
import { QueryFailedError } from 'typeorm';
import { AppLogger } from '../common/app-logger.service.js';
import { ROLE_RANK, roleRank, UserRole } from '../common/roles.js';
import { PasswordService } from '../password/password.service.js';
import { UserAccessService } from './user-access.service.js';
import { User } from './user.entity.js';
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

  /** 分页查询用户（用户管理，仅 admin）；列表仅含操作者可操作的严格低级别账号（排除自己、同级与上级）。 */
  async list(
    actor: ActorContext,
    query: {
      page?: number;
      pageSize?: number;
      status?: number;
      keyword?: string;
    },
  ): Promise<{
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
      excludeId: actor.userId,
      visibleRoles: this.visibleRoles(actor.role),
      status: query.status,
      keyword: query.keyword,
    });
    return { list: rows.map(toSharedUser), total, page, pageSize };
  }

  /**
   * 查询用户详情（用户管理，仅 admin）；与列表及变更操作同层级限制：
   * 仅可查看级别严格低于自己的账号，自己、同级与上级一律拒绝，
   * 避免列表过滤被详情接口绕过。
   */
  async getDetail(actor: ActorContext, id: string): Promise<SharedUser> {
    if (actor.userId === id) {
      throw new ForbiddenException('不能查看自己的账号详情');
    }
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    this.assertOperable(actor.role, user);
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
    // 单列更新：只写 status，避免与并发的 updateRole 互相覆盖对方字段
    await this.usersRepo.updateStatus(id, status);
    const updated = await this.usersRepo.findById(id);
    // 更新后行必存在（刚读到且无删除路径并发删自己以外的行极罕见）：防御性兜底
    if (!updated) throw new NotFoundException('用户不存在');
    await this.userAccess.invalidate(id);
    this.logger.log(
      `user status update userId=${id} status=${status}`,
      UsersService.name,
    );
    return toSharedUser(updated);
  }

  /**
   * 修改用户角色（用户管理，仅 superadmin 可调用，由路由层 @Roles 保证）；
   * 变更后失效缓存，使旧角色权限立即不可用。
   * 目标须严格低于操作者且新角色也须严格低于操作者：
   * superadmin 可在 user / admin 之间调整；superadmin 不经接口授予（DTO 白名单已拦）。
   */
  async updateRole(
    actor: ActorContext,
    id: string,
    role: UserRole,
  ): Promise<SharedUser> {
    if (actor.userId === id) {
      throw new ForbiddenException('不能修改自己的角色');
    }
    const user = await this.usersRepo.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    // 仅 superadmin 可改角色（路由层 @Roles 已拦一道，这里纵深防御直接调用 service 的场景）；
    // 经 roleRank 比较而非字符串直比：ActorContext.role 为 string，直比触发枚举比较 lint 规则，
    // 且未知角色经 rank 为 null 同样被拒绝（fail-closed）
    if (roleRank(actor.role) !== ROLE_RANK[UserRole.SuperAdmin]) {
      throw new ForbiddenException('仅 superadmin 可修改用户角色');
    }
    this.assertOperable(actor.role, user);
    const actorRank = roleRank(actor.role);
    const nextRank = roleRank(role);
    if (actorRank === null || nextRank === null || nextRank >= actorRank) {
      throw new ForbiddenException('不能授予同级或更高级别的角色');
    }
    if (user.role === role) return toSharedUser(user);
    // 单列更新：只写 role，避免与并发的 updateStatus 互相覆盖对方字段
    await this.usersRepo.updateRole(id, role);
    const updated = await this.usersRepo.findById(id);
    if (!updated) throw new NotFoundException('用户不存在');
    await this.userAccess.invalidate(id);
    this.logger.log(
      `user role update userId=${id} role=${role}`,
      UsersService.name,
    );
    return toSharedUser(updated);
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

  // 列表可见级别：仅严格低于操作者的角色；操作者角色未知（null）时返回空数组，
  // 使列表为空而非泄露全量（fail-closed，与变更操作的 assertOperable 同规则）
  private visibleRoles(actorRole: string): UserRole[] {
    const actorRank = roleRank(actorRole);
    if (actorRank === null) return [];
    return (Object.entries(ROLE_RANK) as [UserRole, number][])
      .filter(([, rank]) => rank < actorRank)
      .map(([role]) => role);
  }

  // 层级判定：仅允许操作严格下级，任何一侧角色未知（null）都按拒绝处理（fail-closed）；
  // 自身同级必然不满足，但上面已给出更明确的自我操作报错
  private assertOperable(actorRole: string, target: User): void {
    const actorRank = roleRank(actorRole);
    const targetRank = roleRank(target.role);
    if (actorRank === null || targetRank === null || actorRank <= targetRank) {
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
