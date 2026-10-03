import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
} from './icons';

/**
 * 内联 path data 的回归防线。
 *
 * 背景：icons.tsx 的路径是手写压缩过的官方 SVG（坐标降到 1 位小数省字节）。
 * 一次压缩把 arc 的两个标志位（large-arc-flag / sweep-flag）合并掉了：
 * 官方 `a9.96 9.96 0 000-14.1` 被写成 `a10 10 0 0-14.1`——`0 00` 压成了 `0`；
 * Heart 的 `a260.04 260.04 0 00-56.9-82.8` 被写成 `a260 260 0 0-56.9-82.8`。
 *
 * SVG 规范要求这两个 flag 各是一个 0/1。少一个，解析器读到的参数个数就与 `a` 的
 * 参数表（7 个）不符 → **静默丢弃整条 path**：浏览器不报错，图标直接消失或只剩半截，
 * DOM 完好，肉眼却看到「图标没展示完全」——结构断言查不出来。
 *
 * 这里的做法不是断言某个常量字符串，而是按 SVG 规范解析每条 path，
 * 校验每个命令的**参数个数**与 flag 的合法性：再压坏任何一处，用例立刻红。
 */

/** 每个 path 命令的参数字数（SVG 1.1 path data 语法） */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/**
 * 按 SVG 路径文法逐字符扫描 d，返回每条命令读到的参数。
 *
 * 必须逐字符处理 arc：flag 是**单字符** token。解析器读到 large-arc-flag 后，
 * 紧接着的 sweep-flag 仍按单字符读。所以 `a9.96 9.96 0 0-14.1` 里 `0` 被读成
 * large-arc-flag，下一个字符 `-` 不是合法 flag → 整条命令参数不足，非法。
 */
function parsePath(d: string): { cmd: string; args: string[] }[] {
  const result: { cmd: string; args: string[] }[] = [];
  let i = 0;
  const skipSeparators = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i += 1;
  };
  const readNumber = (): string => {
    skipSeparators();
    const start = i;
    if (d[i] === '+' || d[i] === '-') i += 1;
    // 允许 `.5` 这种省略整数位的写法（官方路径里有 `0.1` 写成 `.1` 的紧凑形式）
    let digits = 0;
    while (i < d.length && /\d/.test(d[i])) {
      i += 1;
      digits += 1;
    }
    if (d[i] === '.') {
      i += 1;
      while (i < d.length && /\d/.test(d[i])) {
        i += 1;
        digits += 1;
      }
    }
    const slice = d.slice(start, i);
    if (digits === 0) {
      throw new Error(`第 ${start} 个字符处不是合法数字：d="${d}"`);
    }
    return slice;
  };
  /** arc 标志位：单字符 0/1 */
  const readFlag = (cmd: string): string => {
    skipSeparators();
    const ch = d[i];
    if (ch !== '0' && ch !== '1') {
      throw new Error(
        `arc 标志位非法：期望单字符 0/1，实际读到 "${ch ?? '<结束>'}"（command=${cmd}，字符 ${i}）`,
      );
    }
    i += 1;
    return ch;
  };

  // prev 记录最近一条**有参数**的命令，用于 SVG 的隐式重复（`l1 1 2 2` = 两次 l）
  let cmd = '';
  let prev = '';
  let args: string[] = [];
  while (i < d.length) {
    skipSeparators();
    if (i >= d.length) break;
    const ch = d[i];
    if (/[a-zA-Z]/.test(ch)) {
      close(result, cmd, args);
      cmd = ch;
      prev = '';
      args = [];
      i += 1;
      if (ARITY[ch.toUpperCase()] === 0) {
        result.push({ cmd: ch, args: [] });
        cmd = '';
      }
      continue;
    }
    if (cmd === '') {
      if (prev === '') {
        throw new Error(`path data 以参数 "${ch}" 开头，缺少命令（字符 ${i}）`);
      }
      cmd = prev;
    }
    const upper = cmd.toUpperCase();
    if (upper === 'A' && (args.length === 3 || args.length === 4)) {
      args.push(readFlag(cmd));
    } else {
      args.push(readNumber());
    }
    if (args.length === ARITY[upper]) {
      // M/m 的后续参数组按 SVG 规范当作 L/l
      const closed = upper === 'M' ? 'L' : upper === 'm' ? 'l' : cmd;
      result.push({ cmd: closed, args });
      prev = closed;
      cmd = '';
      args = [];
    }
  }
  close(result, cmd, args);
  return result;
}

/** 收口一条命令：参数个数不符即非法 path（浏览器会静默丢弃整条） */
function close(
  result: { cmd: string; args: string[] }[],
  cmd: string,
  args: string[],
) {
  if (cmd === '') return;
  const expected = ARITY[cmd.toUpperCase()];
  if (args.length !== expected) {
    throw new Error(
      `命令 ${cmd} 参数个数应为 ${expected}，实际读到 ${args.length}（path 将被浏览器丢弃）：[${args.join(' ')}]`,
    );
  }
  result.push({ cmd, args });
}

function pathDataOf(element: ReactElement) {
  const { container } = render(element);
  const path = container.querySelector('path');
  if (!path) throw new Error('图标未渲染出 path');
  return path.getAttribute('d') ?? '';
}

const ICONS = [
  ['HeartFilled', HeartFilled],
  ['HeartOutlined', HeartOutlined],
  ['LockOutlined', LockOutlined],
  ['GlobalOutlined', GlobalOutlined],
  ['EditOutlined', EditOutlined],
  ['DeleteOutlined', DeleteOutlined],
  ['ApiOutlined', ApiOutlined],
] as const;

describe('icons', () => {
  it.each(ICONS)(
    '%s 的 path data 合法（浏览器不会静默丢弃）',
    (_name, Icon) => {
      expect(parsePath(pathDataOf(<Icon />)).length).toBeGreaterThan(0);
    },
  );

  it.each(ICONS)(
    '%s 的 viewBox 与 antd 官方一致（64 64 896 896）',
    (_name, Icon) => {
      const { container } = render(<Icon />);
      expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(
        '64 64 896 896',
      );
    },
  );

  it('arc 的两个标志位各自都是单字符 0/1（曾被压掉导致半截图标）', () => {
    for (const [, Icon] of ICONS) {
      for (const { cmd, args } of parsePath(pathDataOf(<Icon />))) {
        if (cmd.toUpperCase() !== 'A') continue;
        // a 的参数表：rx ry rotation large-arc-flag sweep-flag x y
        expect(args[3], `${cmd} 的 large-arc-flag`).toMatch(/^[01]$/);
        expect(args[4], `${cmd} 的 sweep-flag`).toMatch(/^[01]$/);
      }
    }
  });

  it('EditOutlined 保留官方两处半圆弧的完整参数（flag 曾被压掉一个）', () => {
    const arcs = parsePath(pathDataOf(<EditOutlined />)).filter(
      (c) => c.cmd === 'a',
    );
    // 官方原文：a9.96 9.96 0 000-14.1（`000` = rot 0 + large-arc 0 + sweep 0）
    expect(arcs[0]?.args).toEqual([
      '9.96',
      '9.96',
      '0',
      '0',
      '0',
      '0',
      '-14.1',
    ]);
    expect(arcs[1]?.args).toEqual([
      '33.5',
      '33.5',
      '0',
      '0',
      '0',
      '9.4',
      '29.8',
    ]);
  });

  it('Heart 图标的弧线保留 large-arc/sweep 两个标志位（曾被压成 0 0-）', () => {
    const arcs = parsePath(pathDataOf(<HeartFilled />)).filter(
      (c) => c.cmd === 'a',
    );
    // 官方 a260.04 260.04 0 00-56.9-82.8：`00` 即 large-arc 0 + sweep 0
    expect(arcs[0]?.args).toEqual([
      '260.04',
      '260.04',
      '0',
      '0',
      '0',
      '-56.9',
      '-82.8',
    ]);
  });

  it('图标尺寸随 font-size 走（1em），不被固定像素裁切', () => {
    const { container } = render(<EditOutlined />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('1em');
    expect(svg?.getAttribute('height')).toBe('1em');
  });
});
