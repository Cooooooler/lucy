import { describe, expect, it } from 'vitest';
import { defaultJsonSerializer, isIsoDateString } from './serializer.js';

describe('isIsoDateString', () => {
  it('识别 ISO-8601 日期字符串', () => {
    expect(isIsoDateString('2026-08-16T10:00:00Z')).toBe(true);
    expect(isIsoDateString('2026-08-16T10:00:00.123Z')).toBe(true);
  });
  it('拒绝非日期字符串', () => {
    expect(isIsoDateString('hello')).toBe(false);
    expect(isIsoDateString('2026-08-16')).toBe(false);
    expect(isIsoDateString('not-a-date')).toBe(false);
  });
});

describe('defaultJsonSerializer', () => {
  it('序列化普通对象', () => {
    expect(defaultJsonSerializer.serialize({ a: 1, b: 'x' })).toBe(
      '{"a":1,"b":"x"}',
    );
  });
  it('顶层 Date 序列化为 ISO 字符串', () => {
    expect(
      defaultJsonSerializer.serialize(new Date('2026-08-16T10:00:00Z')),
    ).toBe('"2026-08-16T10:00:00.000Z"');
  });
  it('对象内 Date 也被序列化为 ISO', () => {
    expect(
      defaultJsonSerializer.serialize({ at: new Date('2026-08-16T10:00:00Z') }),
    ).toBe('{"at":"2026-08-16T10:00:00.000Z"}');
  });
  it('反序列化还原普通 JSON', () => {
    expect(defaultJsonSerializer.deserialize('{"a":1}')).toEqual({ a: 1 });
  });
  it('反序列化把 ISO 日期字符串还原为 Date', () => {
    const v = defaultJsonSerializer.deserialize(
      '{"at":"2026-08-16T10:00:00.000Z"}',
    ) as { at: Date };
    expect(v.at).toBeInstanceOf(Date);
    expect(v.at.toISOString()).toBe('2026-08-16T10:00:00.000Z');
  });
  it('serialize/deserialize round-trip 保持 Date 类型', () => {
    const v = defaultJsonSerializer.deserialize(
      defaultJsonSerializer.serialize({ at: new Date('2026-08-16T10:00:00Z') }),
    ) as { at: Date };
    expect(v.at).toBeInstanceOf(Date);
  });
});
