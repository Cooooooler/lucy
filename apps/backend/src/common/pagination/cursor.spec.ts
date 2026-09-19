import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const cursorOf = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('cursor', () => {
  it('编码后可无损解码时间戳、id 与排序键', () => {
    const ts = new Date('2026-01-02T03:04:05.678Z');
    const cursor = encodeCursor(ts, ID, 'updatedAt');
    const decoded = decodeCursor(cursor, 'updatedAt');
    expect(decoded.timestamp.toISOString()).toBe(ts.toISOString());
    expect(decoded.id).toBe(ID);
  });

  it('游标为 URL 安全字符', () => {
    const cursor = encodeCursor(
      new Date('2026-01-02T03:04:05.678Z'),
      ID,
      'createdAt',
    );
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('合法 UUID 大小写均可通过', () => {
    const lower = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: ID,
      k: 'createdAt',
    });
    const upper = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: ID.toUpperCase(),
      k: 'createdAt',
    });
    expect(decodeCursor(lower, 'createdAt').id).toBe(ID);
    expect(decodeCursor(upper, 'createdAt').id).toBe(ID.toUpperCase());
  });

  it('排序键不匹配的游标抛 400（两个列表的游标不可互换）', () => {
    // 知识库/文档按 created_at 签出的游标拿到会话列表（updated_at）用：不拦就会拿错列
    // 做行比较，静默返回错误或空的页
    const byCreatedAt = encodeCursor(new Date(), ID, 'createdAt');
    expect(() => decodeCursor(byCreatedAt, 'updatedAt')).toThrow(
      BadRequestException,
    );
    expect(decodeCursor(byCreatedAt, 'createdAt').id).toBe(ID);
  });

  it('缺少排序键字段的旧游标抛 400', () => {
    const legacy = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: ID });
    expect(() => decodeCursor(legacy, 'createdAt')).toThrow(
      BadRequestException,
    );
  });

  it('排序键取值非法抛 400', () => {
    const bad = cursorOf({ t: '2026-01-01T00:00:00.000Z', i: ID, k: 'name' });
    expect(() => decodeCursor(bad, 'createdAt')).toThrow(BadRequestException);
  });

  it('非法 base64/JSON 抛 400', () => {
    expect(() => decodeCursor('!!!not-base64!!!', 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor('abc', 'createdAt')).toThrow(BadRequestException);
  });

  it('字段缺失或类型错误抛 400', () => {
    const missingId = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      k: 'createdAt',
    });
    const badTime = cursorOf({ t: 'not-a-date', i: ID, k: 'createdAt' });
    const emptyId = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: '',
      k: 'createdAt',
    });
    const notObject = cursorOf('str');
    expect(() => decodeCursor(missingId, 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(badTime, 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(emptyId, 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(notObject, 'createdAt')).toThrow(
      BadRequestException,
    );
  });

  it('id 非 UUID 抛 400（伪造游标不该变成 500）', () => {
    // 非 UUID 的 id 一旦进入 SQL，Postgres 会在 `uuid = character varying` 比较时报 22P02
    const notUuid = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: 'abc',
      k: 'createdAt',
    });
    const truncated = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: ID.slice(0, 8),
      k: 'createdAt',
    });
    const numeric = cursorOf({
      t: '2026-01-01T00:00:00.000Z',
      i: 123,
      k: 'createdAt',
    });
    expect(() => decodeCursor(notUuid, 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(truncated, 'createdAt')).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(numeric, 'createdAt')).toThrow(
      BadRequestException,
    );
  });
});
