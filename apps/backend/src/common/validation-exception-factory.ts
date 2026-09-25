import { BadRequestException, type ValidationError } from '@nestjs/common';
import { VALIDATION_MESSAGES, fieldLabel } from './messages.js';

const CHINESE_RE = /[\u4e00-\u9fa5]/;

interface ResolvedConstraint {
  property: string;
  key: string;
  message: string;
  constraints?: unknown[];
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
  const [key, message] = entries[0];
  const constraints = (
    error.contexts?.[key] as { constraints?: unknown[] } | undefined
  )?.constraints;
  return { property: current, key, message, constraints };
}

function toReadableMessage(resolved: ResolvedConstraint): string {
  // DTO 已显式声明的中文自定义提示（如「无效的分页游标」）原样保留
  if (CHINESE_RE.test(resolved.message)) return resolved.message;
  const leaf = resolved.property.split('.').pop() ?? resolved.property;
  const label = fieldLabel(leaf);
  const template = VALIDATION_MESSAGES[resolved.key];
  if (!template) return `「${label}」参数不合法`;
  return template(label, resolved.constraints);
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
  return new BadRequestException('请求参数有误');
}
