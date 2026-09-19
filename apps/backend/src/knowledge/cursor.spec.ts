import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const cursorOf = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('cursor', () => {
  it('编码后可无损解码时间戳与 id', () => {
    const ts = new Date('2026-01-02T03:04:05.678Z');
    const cursor = encodeCursor(ts, ID);
    const decoded = decodeCursor(cursor);
    expect(decoded.timestamp.toISOString()).toBe(ts.toISOString());
    expect(decoded.id).toBe(ID);
  });

  it('游标为 URL 安全字符', () => {
    const cursor = encodeCursor(new Date('2026-01-02T03:04:05.678Z'), ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('合法 UUID 大小写均可通过', () => {
    const lower = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: ID });
    const upper = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: ID.toUpperCase(),
    });
    expect(decodeCursor(lower).id).toBe(ID);
    expect(decodeCursor(upper).id).toBe(ID.toUpperCase());
  });

  it('非法 base64/JSON 抛 400', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(BadRequestException);
    expect(() => decodeCursor('abc')).toThrow(BadRequestException);
  });

  it('字段缺失或类型错误抛 400', () => {
    const missingId = cursorOf({ t: '2026-01-01T00:00:00.000Z' });
    const badTime = cursorOf({ t: 'not-a-date', i: ID });
    const emptyId = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: '' });
    const notObject = cursorOf('str');
    expect(() => decodeCursor(missingId)).toThrow(BadRequestException);
    expect(() => decodeCursor(badTime)).toThrow(BadRequestException);
    expect(() => decodeCursor(emptyId)).toThrow(BadRequestException);
    expect(() => decodeCursor(notObject)).toThrow(BadRequestException);
  });

  it('id 非 UUID 抛 400（伪造游标不该变成 500）', () => {
    // 非 UUID 的 id 一旦进入 SQL，Postgres 会在 `uuid = character varying` 比较时报 22P02
    const notUuid = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: 'abc' });
    const truncated = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: ID.slice(0, 8),
    });
    const numeric = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: 123 });
    expect(() => decodeCursor(notUuid)).toThrow(BadRequestException);
    expect(() => decodeCursor(truncated)).toThrow(BadRequestException);
    expect(() => decodeCursor(numeric)).toThrow(BadRequestException);
  });
});
