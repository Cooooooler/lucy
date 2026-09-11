# 用户角色层级（RBAC1）设计

- 日期：2026-09-11
- 状态：已实施
- 分支：feature/user-management
- 涉及：`apps/backend`（users / auth / 迁移）、`packages/shared`（契约类型重新生成）

## 1. 背景与目标

用户管理接口已落地，但角色是**扁平**的（`user` / `admin` 两个互不隶属的取值），由此产生两个问题：

1. **无法管理管理员**：管理员之间互相不可操作（同级保护），于是没有任何角色能禁用/删除一个管理员。
2. 若放开同级操作，则「管理员互相禁用」和「最后一个管理员被删」会导致永久失去管理入口，即**自锁**。

目标：引入全序角色层级，用**级别比较**取代「角色名精确匹配」与「同级一律禁止」，从结构上消除自锁，同时支持管理员之间的管理。

## 2. 决策记录

### 2.1 用级别（rank）而不是权限表

角色之间是**全序**关系（`user < admin < superadmin`，任意两者可比高低），因此用级别数字表达即可。不引入 `roles` / `permissions` / `role_permissions` 三表与策略引擎（Casbin 等）——那是为**偏序**（互不可比的能力维度，如「内容管理员」「用户管理员」）准备的，本阶段引入只会增加守卫、缓存与前端菜单的复杂度而无收益。

对照 NIST RBAC 分层，本次落在 **RBAC1（角色继承）最简形式 + 同级/上级保护**，不引入 permission 表。

### 2.2 层级放代码，不改表结构语义

`role` 列仍是 `varchar(20)` 字符串枚举，**级别映射放 TypeScript**（`ROLE_RANK`）。表上只加一条 `CHECK` 约束限制取值集合。理由：级别是「比较规则」而非「数据」，放代码便于调整且免迁移；`CHECK` 保证手写 SQL 不会写入非法角色。

### 2.3 `@Roles` 语义变为「该级别及以上」

守卫从 `required.includes(role)`（精确匹配）改为 `rank(actor) >= min(rank(required))`。这是**破坏性语义变更**：`@Roles(Admin)` 现在表示「admin 及以上」，因此 `superadmin` 也能访问。一次性改干净，不保留两套语义并存。

### 2.4 操作权限：只能操作**严格下级**

`rank(actor) > rank(target)` 才允许启用/禁用/删除。由此：

| actor → target          | 结果                             |
| ----------------------- | -------------------------------- |
| user → user             | 拒绝（同级）                     |
| admin → user            | 允许                             |
| admin → admin           | 拒绝（同级保护）                 |
| admin → superadmin      | 拒绝（上级保护）                 |
| superadmin → user       | 允许                             |
| superadmin → admin      | 允许（本设计要解决的场景）       |
| superadmin → superadmin | 拒绝（不存在更高级别，天然保护） |

**「暂时没有任何操作 superadmin 的接口」由层级自动保证**：不存在比 superadmin 更高的级别，故其永远不可被操作。将来若新增更高级别角色，superadmin 会随之变为可操作对象——这是层级的预期行为。

### 2.5 自我操作保护是操作级规则，不进守卫

「不能操作自己」保留在 service 的操作方法内（且排在最前，给出更明确的报错），因为它只适用于危险操作（禁用/删除）；个人资料修改（改昵称、改密码）必须允许操作自己。若上提到 `RolesGuard` 会误杀个人资料类接口。

注意：自我操作在层级上已被 `rank(actor) > rank(target)` 覆盖（自身同级必然不满足），保留显式检查纯粹为了**报错可读性**。

### 2.6 角色不入 JWT

角色继续由 `UserAccessService` 从 Redis 短 TTL 缓存读取（`status` + `role` 一次取回，30s TTL，变更时 `invalidate`），不编码进 token。理由：编码进 token 会使角色降级要等 token 过期才生效，是安全漏洞。

## 3. 实现

### 3.1 角色与层级（`common/roles.ts`）

角色定义放在 **common** 而非 users 领域内：它同时被鉴权元数据（`@Roles`）、守卫与用户领域消费；若留在 `users/`，`common/decorators/roles.decorator.ts` 就得反向依赖领域模块（该项目此前已确立 common 不依赖领域的约定）。

```ts
export enum UserRole {
  User = 'user',
  Admin = 'admin',
  SuperAdmin = 'superadmin',
}

export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.User]: 10,
  [UserRole.Admin]: 20,
  [UserRole.SuperAdmin]: 30,
};

/** 未知角色返回 null，调用方必须按 fail-closed 处理，不可当作最低级别比较 */
export function roleRank(role: string): number | null {
  return ROLE_RANK[role as UserRole] ?? null;
}
```

**禁止用角色名字符串比较**（`'admin' > 'user'` 字典序无意义，且 `'user' > 'superadmin'` 会错误成立）。必须先经 `roleRank` 转数值。

`roleRank` 返回 `null` 而非 `0` 是关键：若把未知角色当 0（最低级别），则 `@Roles('Admin')`（拼写错误）会让阈值退化为 0，任何已认证用户都能通过——鉴权静默失效。返回 `null` 强制调用方显式处理。

### 3.2 迁移（`AddUserRoleHierarchy`）

1. `ALTER TABLE users ADD CONSTRAINT CHK_users_role CHECK (role IN ('user','admin','superadmin'))`
2. 将引导账号提升为 superadmin（见 §4）

### 3.3 守卫（`auth/roles.guard.ts`）

`required` 中任一角色的级别 ≤ 当前用户级别即放行；未标注 `@Roles` 放行。

两处 **fail-closed**，不可退化为「未知即最低级别」：

1. `@Roles` 中出现无法识别的角色（拼写错误/脏元数据）→ 直接拒绝。否则阈值退化为 0，路由对所有登录用户开放；
2. 当前用户 `role` 缺失或未知 → 拒绝。

编译期另有 `Roles(...roles: UserRole[])` 把参数限定为 `UserRole`，使角色名拼写错误在编译期即暴露。

### 3.4 服务（`users/users.service.ts`）

`assertOperable(actorRole, target)`：仅当 `roleRank(actorRole) > roleRank(target.role)` 才放行，任一侧为 `null`（角色未知）也抛 403「不能操作同级或更高级别的账号」。`updateStatus` / `remove` 接收 `{ userId, role }` 形式的操作者上下文（控制器从 `@CurrentUser()` 传入）。

## 4. 引导（bootstrap）超级管理员

**superadmin 没有任何创建/提升接口**（有意为之，避免提权面），因此每个环境必须一次性手工提升，SQL 如下（替换为目标的真实 UUID）：

```sql
UPDATE "users" SET "role" = 'superadmin' WHERE "id" = '<目标用户 UUID>';
```

本仓库已在迁移 `AddUserRoleHierarchy1789300000000` 中带上**开发环境**的引导账号：

- `69c2ec06-0552-4bdc-af29-d867f0f239f0`（username `lucy`）

⚠️ 该 UUID 是环境相关的：**其他环境（如生产）需自行执行上面的 SQL 提升本地账号**，迁移里的 UUID 在其上大概率匹配 0 行（无副作用）。

## 5. 测试

- `roles.guard.spec`：superadmin 通过 `@Roles(Admin)`；admin 不通过 `@Roles(SuperAdmin)`；未知角色 fail-closed；未标注 `@Roles` 放行。
- `users.service.spec`：admin→user 允许；admin→admin 拒绝；admin→superadmin 拒绝；superadmin→admin 允许；superadmin→superadmin 拒绝；操作自己拒绝（且不触达仓储）。
- 被拒绝时断言未调用 `save` / `delete` / `invalidate`（拒绝必须发生在写入之前）。

## 6. 风险与取舍

- **`@Roles` 语义变更**是破坏性的：现有 `@Roles(UserRole.Admin)` 路由现在也接受 superadmin。当前仅 `UsersController` 使用，已确认语义正确。
- **引导依赖手工 SQL**：新环境若忘记提升，用户管理接口将无人可访问（普通用户 403）。这是「不提供提权接口」的必然代价，属有意的安全取舍。
- **`CHECK` 约束使新增角色需要迁移**：属预期（显式优于隐式）。
- 未做（YAGNI）：permission 表、角色继承的传递闭包、多管理员维度、审计日志。
