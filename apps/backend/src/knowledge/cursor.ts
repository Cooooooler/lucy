import { BadRequestException } from '@nestjs/common';

/**
 * 游标分页载荷：以 (排序时间戳, 主键) 作为 keyset 定位点。
 * 时间戳为 ISO 字符串（毫秒精度，JS Date 的固有精度）；因此服务端排序/过滤必须把
 * 时间列截断到毫秒后再比较，否则同一毫秒内亚毫秒并列的行会被整批跳过（见
 * knowledge.service.ts 的 cursorTsExpr）。
 */
interface CursorPayload {
  t: string;
  i: string;
}

/** 将一条记录的排序键编码为不透明游标（base64url，URL 安全）。 */
export function encodeCursor(timestamp: Date, id: string): string {
  const payload: CursorPayload = { t: timestamp.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 解码游标；任何格式错误统一抛 400，避免把非法输入带进 SQL。
 * @throws BadRequestException 游标为空/非 base64/非 JSON/字段缺失/时间非法
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
  if (typeof t !== 'string' || typeof i !== 'string' || i.length === 0) {
    throw new BadRequestException('无效的分页游标');
  }
  const timestamp = new Date(t);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException('无效的分页游标');
  }
  return { timestamp, id: i };
}
