/** 可替换的序列化器：setJson/getJson 走 serialize/deserialize */
export interface RedisSerializer {
  serialize(value: unknown): string;
  deserialize(text: string): unknown;
}

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** 判断字符串是否为严格 ISO-8601 日期格式（反序列化时据此还原 Date） */
export function isIsoDateString(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

/** 默认 JSON 序列化器：Date 存为 ISO 字符串，读回时还原为 Date */
export const defaultJsonSerializer: RedisSerializer = {
  serialize(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
      v instanceof Date ? v.toISOString() : v,
    );
  },
  deserialize(text: string): unknown {
    return JSON.parse(text, (_key, v) =>
      typeof v === 'string' && isIsoDateString(v) ? new Date(v) : v,
    );
  },
};
