import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../common/roles.js';
import { User } from './user.entity.js';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.repo.findOneBy({ id });
  }

  /** 仅查询认证所需列（status/role），供每请求鉴权使用（避免拉取整行）。 */
  async findAccessById(
    id: string,
  ): Promise<{ status: number; role: UserRole } | null> {
    const user = await this.repo.findOne({
      where: { id },
      select: { status: true, role: true },
    });
    return user ? { status: user.status, role: user.role } : null;
  }

  /**
   * 分页查询用户，按创建时间倒序；status/keyword 为可选过滤条件，始终排除操作者自己。
   * visibleRoles 为空数组时直接返回空结果（无可见级别）；非空时以 IN 过滤，
   * 使列表仅含操作者可操作的严格低级别账号。
   * 只投影对外契约所需的 8 列：passwordHash 等敏感列不进应用内存。
   */
  findPage(params: {
    page: number;
    pageSize: number;
    excludeId: string;
    visibleRoles?: UserRole[];
    status?: number;
    keyword?: string;
  }): Promise<[User[], number]> {
    if (params.visibleRoles && params.visibleRoles.length === 0) {
      return Promise.resolve([[], 0]);
    }
    const qb = this.repo
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.username',
        'u.email',
        'u.nickname',
        'u.status',
        'u.role',
        'u.createdAt',
        'u.updatedAt',
      ])
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'DESC')
      .andWhere('u.id != :excludeId', { excludeId: params.excludeId });
    if (params.visibleRoles) {
      qb.andWhere('u.role IN (:...visibleRoles)', {
        visibleRoles: params.visibleRoles,
      });
    }
    if (params.status !== undefined) {
      qb.andWhere('u.status = :status', { status: params.status });
    }
    if (params.keyword) {
      qb.andWhere(
        '(u.username ILIKE :kw OR u.email ILIKE :kw OR u.nickname ILIKE :kw)',
        { kw: `%${params.keyword}%` },
      );
    }
    qb.skip((params.page - 1) * params.pageSize).take(params.pageSize);
    return qb.getManyAndCount();
  }

  /** 按主键删除用户；关联数据由数据库外键 ON DELETE CASCADE 清理。 */
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  /**
   * 单列更新状态：只写 status 列，避免“读整行改一列再 save”与并发的
   * updateRole 互相覆盖对方字段（如禁用与改角色并发时静默撤销禁用）。
   */
  async updateStatus(id: string, status: number): Promise<void> {
    await this.repo.update({ id }, { status });
  }

  /** 单列更新角色：只写 role 列，同 updateStatus 的并发覆盖考量。 */
  async updateRole(id: string, role: UserRole): Promise<void> {
    await this.repo.update({ id }, { role });
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
    role?: UserRole;
  }): User {
    return this.repo.create({
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      nickname: input.nickname ?? null,
      status: input.status,
      role: input.role ?? UserRole.User,
    });
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }
}
