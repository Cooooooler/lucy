#!/usr/bin/env node
/**
 * 测试巡检：找出两类最容易随规模膨胀、却几乎不带回归价值的用例。
 *
 * 1. 零断言：文件里没有任何 `expect(...)`，测试跑通与否不表达约束。
 * 2. 纯委托：controller spec 的断言全部是 `toHaveBeenCalled*`，只验证「参数被转交」，
 *    真正的行为应由 e2e 覆盖。
 * 3. 聚焦/跳过：`it.only` / `describe.only` 会让 CI 只跑一个子集却仍然全绿；
 *    `.skip` / `.todo` 则会把用例静默从门禁里摘掉，必须在提交前显式处置。
 *
 * 默认只报告（退出码 0）；加 `--fail` 时在发现问题的情况下以退出码 1 结束，便于接入 CI。
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const TARGETS = [
  'apps/backend/src',
  'apps/backend/test',
  'apps/frontend/src',
  'apps/frontend/e2e',
  'packages',
];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  'out',
]);
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;
const EXPECT = /\bexpect\s*\(/g;
const MOCK_ASSERT = /\btoHaveBeenCalled[A-Za-z]*/g;
const FOCUSED = /\b(?:it|test|describe)\.only\s*\(/g;
const SKIPPED = /\b(?:it|test|describe)\.(?:skip|todo)\s*\(/g;
// 显式豁免：controller spec 断言的是参数映射/转换（不是原样透传）时，在文件里写
// `audit-allow: delegation-only` 说明理由，跳过「纯委托」判定。
const ALLOW_DELEGATION = /audit-allow:\s*delegation-only/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEST_FILE.test(entry.name)) yield full;
  }
}

/** 去掉注释后再计数，避免文档注释里的 `toHaveBeenCalledWith` 之类造成误报 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function countMatches(text, re) {
  return (text.match(re) ?? []).length;
}

const zeroAssertion = [];
const delegationOnly = [];
const focused = [];
const skipped = [];
let total = 0;

for (const target of TARGETS) {
  for await (const file of walk(path.join(ROOT, target))) {
    total += 1;
    const raw = await readFile(file, 'utf8');
    const text = stripComments(raw);
    const expects = countMatches(text, EXPECT);
    const mockAsserts = countMatches(text, MOCK_ASSERT);
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');

    if (countMatches(text, FOCUSED) > 0) focused.push(rel);
    if (countMatches(text, SKIPPED) > 0) skipped.push(rel);

    if (expects === 0) {
      zeroAssertion.push(rel);
    } else if (
      file.endsWith('.controller.spec.ts') &&
      mockAsserts >= expects &&
      !ALLOW_DELEGATION.test(raw)
    ) {
      delegationOnly.push(rel);
    }
  }
}

console.log(`扫描测试文件：${total} 个`);
if (zeroAssertion.length > 0) {
  console.log(`\n零断言（${zeroAssertion.length}）：`);
  for (const file of zeroAssertion) console.log(`  - ${file}`);
}
if (delegationOnly.length > 0) {
  console.log(`\n纯委托 controller 断言（${delegationOnly.length}）：`);
  for (const file of delegationOnly) console.log(`  - ${file}`);
}
if (focused.length > 0) {
  console.log(`\n聚焦用例 .only（${focused.length}）：`);
  for (const file of focused) console.log(`  - ${file}`);
}
if (skipped.length > 0) {
  console.log(`\n跳过用例 .skip/.todo（${skipped.length}）：`);
  for (const file of skipped) console.log(`  - ${file}`);
}
if (
  zeroAssertion.length +
    delegationOnly.length +
    focused.length +
    skipped.length ===
  0
) {
  console.log('未发现零断言、纯委托、聚焦或跳过用例。');
}

if (
  process.argv.includes('--fail') &&
  zeroAssertion.length +
    delegationOnly.length +
    focused.length +
    skipped.length >
    0
) {
  process.exitCode = 1;
}
