import { BadRequestException, type ValidationError } from '@nestjs/common';
import {
  BAD_REQUEST_MESSAGE,
  fieldLabel,
  TYPE_CONSTRAINT_KEYS,
  VALIDATION_MESSAGES,
} from './messages.js';

const CHINESE_RE = /[\u4e00-\u9fa5]/;

interface ResolvedConstraint {
  property: string;
  key: string;
  message: string;
}

/**
 * 失败约束里优先取类型类约束键（清单与文案模板集中在 messages.ts 一并维护）：
 * `error.constraints` 的键序跟随**装饰器注册顺序**（自下而上），min/max/minLength/maxLength
 * 常注册在前——`{"name": null}` 这样「类型与长度都失败」的载荷会先命中长度约束，
 * 报「名称过长」这类误导文案；类型错才是 null 的真实原因。没有任何类型类约束命中时
 * 仍取第一个键（原行为不变）。
 */
function pickConstraintKey(entries: [string, unknown][]): string {
  const keys = new Set(entries.map(([key]) => key));
  for (const preferred of TYPE_CONSTRAINT_KEYS) {
    if (keys.has(preferred)) return preferred;
  }
  return entries[0][0];
}

// 递归取第一个命中的约束。嵌套 DTO 用点路径保留上下文
// （如 `分页.每页条数` 回退显示时仍可定位），文案标签取叶子字段名。
function findFirst(
  error: ValidationError,
  path: string,
): ResolvedConstraint | null {
  const current = path ? `${path}.${error.property}` : error.property;
  if (error.children?.length) {
    for (const child of error.children) {
      const found = findFirst(child, current);
      if (found) return found;
    }
    return null;
  }
  const entries = Object.entries(error.constraints ?? {});
  if (!entries.length) return null;
  const key = pickConstraintKey(entries);
  const message = error.constraints?.[key] ?? entries[0][1];
  return { property: current, key, message };
}

function toReadableMessage(resolved: ResolvedConstraint): string {
  // DTO 已显式声明的中文自定义提示（如「无效的分页游标」）原样保留
  if (CHINESE_RE.test(resolved.message)) return resolved.message;
  const leaf = resolved.property.split('.').pop() ?? resolved.property;
  const label = fieldLabel(leaf);
  const template = VALIDATION_MESSAGES[resolved.key];
  if (!template) return `「${label}」参数不合法`;
  return template(label);
}

/**
 * 全局 ValidationPipe 的 exceptionFactory：把 class-validator 的英文默认提示
 * （如 `title must be a string`）转成一句可读中文，失败原因由后端统一操控。
 * 一次只取第一个错误，避免把整棵 ValidationError 树（英文）抛给前端。
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  for (const error of errors) {
    const resolved = findFirst(error, '');
    if (resolved) return new BadRequestException(toReadableMessage(resolved));
  }
  return new BadRequestException(BAD_REQUEST_MESSAGE);
}
