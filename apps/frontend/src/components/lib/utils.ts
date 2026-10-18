import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1024 进制的单位表（顺序即换算顺序） */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 把字节数格式化为人类可读大小（知识库详情页的文件表格用）：B 不带小数，其余保留 1 位 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exp;
  return `${exp === 0 ? String(value) : value.toFixed(1)} ${BYTE_UNITS[exp] ?? 'B'}`;
}
