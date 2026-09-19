import { BadRequestException } from '@nestjs/common';

/**
 * 游标分页载荷：以 (排序时间戳, 主键) 作为 keyset 定位点。
 * 时间戳为 ISO 字符串（毫秒精度，JS Date 的固有精度）；数据库侧的时间列由迁移保证
 * 毫秒对齐（默认值亦为 date_trunc('milliseconds', now())），因此可直接与原始列比较，
 * 无需在 SQL 里再做截断。
 */
interface CursorPayload {
  t: string;
  i: string;
}

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
export function encodeCursor(timestamp: Date, id: string): string {
  const payload: CursorPayload = { t: timestamp.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 解码游标；任何格式错误统一抛 400，避免把非法输入带进 SQL。
 * @throws BadRequestException 游标为空/非 base64/非 JSON/字段缺失/时间非法/id 非 UUID
 */
export function decodeCursor(cursor: string): { timestamp: Date; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('无效的分页游标');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new BadRequestException('无效的分页游标');
  }
  const { t, i } = parsed as Partial<CursorPayload>;
  if (typeof t !== 'string' || typeof i !== 'string' || !UUID_PATTERN.test(i)) {
    throw new BadRequestException('无效的分页游标');
  }
  const timestamp = new Date(t);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException('无效的分页游标');
  }
  return { timestamp, id: i };
}
