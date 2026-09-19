import { BadRequestException } from '@nestjs/common';

/**
 * 游标分页载荷：以 (排序键时间戳, 主键, 排序键) 作为 keyset 定位点。
 * 时间戳为 ISO 字符串（毫秒精度，JS Date 的固有精度）；数据库侧的时间列由实体的
 * 列默认值保证毫秒对齐（`date_trunc('milliseconds', now())`），因此可直接与原始列比较，
 * 无需在 SQL 里再做截断。
 */
interface CursorPayload {
  t: string;
  i: string;
  k: CursorSortKey;
}

/**
 * 游标携带的排序键属性名。
 *
 * 为什么游标必须记住它指向哪一列：`KeysetPaginator` 支持 `createdAt` 与 `updatedAt` 两种排序键，
 * 而游标只是一个不透明字符串 —— 不记录排序键时，知识库/文档列表（`created_at`）与会话列表
 * （`updated_at`）的游标可以互换，解码照过，于是拿错列做行比较，**静默**返回错误或空的页
 * （浏览器缓存的旧游标也落在这一类）。
 */
export type CursorSortKey = 'createdAt' | 'updatedAt';

/**
 * 游标入参约束的**唯一定义处**（两个列表查询 DTO 的 `@MaxLength` / `@Matches` 都从这里取）：
 * 三处（两个 DTO + 本文件的解码）各写一份时，改一处就会漂移成「DTO 放行、解码 400」。
 */
export const CURSOR_MAX_LENGTH = 512;

/** base64url 字符集：不符者直接 400，避免把任意长/带特殊字符的输入带进解码与 SQL */
export const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * UUID 校验（大小写均可）。主键是 uuid 列：伪造/截断的 id 一旦带进 SQL，Postgres 会在
 * `uuid = character varying` 比较时抛 22P02（invalid input syntax for type uuid），
 * 表现为 500；故在解码入口就拦成 400。
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 将一条记录的排序键编码为不透明游标（base64url，URL 安全）。 */
export function encodeCursor(
  timestamp: Date,
  id: string,
  sortKey: CursorSortKey,
): string {
  const payload: CursorPayload = {
    t: timestamp.toISOString(),
    i: id,
    k: sortKey,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 解码游标；任何格式错误统一抛 400，避免把非法输入带进 SQL。
 *
 * `k` 必须与调用方当前使用的排序键一致：不一致（含缺少 `k` 的旧游标）一律拒绝，
 * 否则会拿另一列做行比较而静默返回错误/空的页。
 * @throws BadRequestException 游标为空/非 base64/非 JSON/字段缺失/时间非法/id 非 UUID/排序键不匹配
 */
export function decodeCursor(
  cursor: string,
  sortKey: CursorSortKey,
): { timestamp: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('无效的分页游标');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new BadRequestException('无效的分页游标');
  }
  const { t, i, k } = parsed as Partial<CursorPayload>;
  if (
    typeof t !== 'string' ||
    typeof i !== 'string' ||
    !UUID_PATTERN.test(i) ||
    k !== sortKey
  ) {
    throw new BadRequestException('无效的分页游标');
  }
  const timestamp = new Date(t);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException('无效的分页游标');
  }
  return { timestamp, id: i };
}
