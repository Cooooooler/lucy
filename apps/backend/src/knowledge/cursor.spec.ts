import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor', () => {
  it('编码后可无损解码时间戳与 id', () => {
    const ts = new Date('2026-01-02T03:04:05.678Z');
    const cursor = encodeCursor(ts, 'kb-1');
    const decoded = decodeCursor(cursor);
    expect(decoded.timestamp.toISOString()).toBe(ts.toISOString());
    expect(decoded.id).toBe('kb-1');
  });

  it('游标为 URL 安全字符', () => {
    const cursor = encodeCursor(new Date('2026-01-02T03:04:05.678Z'), 'a/b+c=');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('非法 base64/JSON 抛 400', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(BadRequestException);
    expect(() => decodeCursor('abc')).toThrow(BadRequestException);
  });

  it('字段缺失或类型错误抛 400', () => {
    const missingId = Buffer.from(
      JSON.stringify({ t: '2026-01-01T00:00:00.000Z' }),
    ).toString('base64url');
    const badTime = Buffer.from(
      JSON.stringify({ t: 'not-a-date', i: 'kb-1' }),
    ).toString('base64url');
    const emptyId = Buffer.from(
      JSON.stringify({ t: '2026-01-01T00:00:00.000Z', i: '' }),
    ).toString('base64url');
    const notObject = Buffer.from(JSON.stringify('str')).toString('base64url');
    expect(() => decodeCursor(missingId)).toThrow(BadRequestException);
    expect(() => decodeCursor(badTime)).toThrow(BadRequestException);
    expect(() => decodeCursor(emptyId)).toThrow(BadRequestException);
    expect(() => decodeCursor(notObject)).toThrow(BadRequestException);
  });
});
