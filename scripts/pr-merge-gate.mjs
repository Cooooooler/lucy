#!/usr/bin/env node
/**
 * 合并前自检：把 AGENTS.md「评审前置」里的手工核对收敛成一条命令。
 *
 *   pnpm pr:gate <pr-number>
 *
 * 检查项：
 *   1. PR 处于 OPEN、非 draft、mergeStateStatus = CLEAN；
 *   2. `gh pr checks` 全部 pass/skipping；
 *   3. 变更路径是否涉及 apps/frontend/** 或 apps/backend/**；
 *      - 涉及：最新一条 `<!-- pr-skill-review -->` 评论里的「评审 commit」必须等于当前 head；
 *      - 不涉及：PR 正文必须显式写「技能评审 N/A」。
 *
 * 退出码：0 = 可以合并；1 = 有阻塞项；2 = 用法错误。
 * 只依赖 gh CLI 与 Node 内置模块，不引入额外依赖。
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const REVIEW_MARKER = '<!-- pr-skill-review -->';
const REVIEW_COMMIT_RE = /评审 commit `([0-9a-f]{7,40})`/i;
const REVIEWED_PATHS = ['apps/frontend/', 'apps/backend/'];

const prNumber = process.argv[2];
if (!/^\d+$/.test(prNumber ?? '')) {
  console.error('用法: pnpm pr:gate <pr-number>');
  process.exit(2);
}

/** 执行 gh；非零退出码不抛错，返回 stdout/stderr 供调用方判断（gh pr checks 有阻塞项时 exit 8）。 */
function gh(args) {
  try {
    return {
      ok: true,
      out: execFileSync('gh', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? '').trim(),
      err: String(error.stderr ?? '').trim() || error.message,
    };
  }
}

function ghJson(args) {
  const result = gh(args);
  if (!result.out) {
    throw new Error(`gh ${args.join(' ')} 无输出: ${result.err ?? ''}`);
  }
  return JSON.parse(result.out);
}

const failures = [];
const notes = [];

const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
const pr = ghJson([
  'pr',
  'view',
  prNumber,
  '--json',
  'state,isDraft,headRefOid,mergeable,mergeStateStatus,baseRefName,body,comments',
]);

if (pr.state !== 'OPEN') failures.push(`PR 状态是 ${pr.state}，不是 OPEN`);
if (pr.isDraft) failures.push('PR 仍是 draft');
if (pr.state === 'OPEN') {
  if (pr.mergeable !== 'MERGEABLE') {
    failures.push(`mergeable = ${pr.mergeable}`);
  }
  if (pr.mergeStateStatus !== 'CLEAN') {
    failures.push(`mergeStateStatus = ${pr.mergeStateStatus}，不是 CLEAN`);
  }
}

// gh pr checks 在有失败/待执行检查时退出码为 8，但 stdout 仍是完整 JSON
const checks = ghJson([
  'pr',
  'checks',
  prNumber,
  '--json',
  'name,state,bucket,link',
]);
const badChecks = checks.filter(
  (check) => !['pass', 'skipping'].includes(check.bucket),
);
if (checks.length === 0) failures.push('没有任何 CI 检查结果');
for (const check of badChecks) {
  failures.push(
    `CI 未通过: ${check.name} (${check.bucket}) ${check.link ?? ''}`.trim(),
  );
}

// ruleset 把 skill-review 作为 required check；没有状态时 GitHub 会挡住合并，
// 这里提前给出可读原因，而不是让 gh pr merge 只报一句 general error。
// 同一 context 可能有多条历史状态（pending → success），取最新一条。
const combinedStatus = ghJson([
  'api',
  `repos/${repo}/commits/${pr.headRefOid}/status`,
]);
const skillStatus = (combinedStatus.statuses ?? [])
  .filter((status) => status.context === 'skill-review')
  .sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
if (!skillStatus) {
  failures.push(
    'head SHA 上没有 skill-review 状态：先在该 PR 评论 /skill-review（docs/CI-only PR 也需要）',
  );
} else if (skillStatus.state === 'pending') {
  failures.push('skill-review 仍是 pending：评审进行中，等 run 结束');
} else if (skillStatus.state !== 'success') {
  failures.push(
    `skill-review 状态是 ${skillStatus.state}：${skillStatus.description ?? '无描述'}`,
  );
} else {
  notes.push(`skill-review: success（${skillStatus.description ?? '无描述'}）`);
}

const files = gh(['pr', 'diff', prNumber, '--name-only'])
  .out.split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const needsReview = files.some((file) =>
  REVIEWED_PATHS.some((prefix) => file.startsWith(prefix)),
);

if (needsReview) {
  const reviewComments = (pr.comments ?? []).filter((comment) =>
    (comment.body ?? '').startsWith(REVIEW_MARKER),
  );
  const latest = reviewComments.at(-1);
  if (!latest) {
    failures.push(
      '改动涉及 apps/** 但没有任何技能评审评论：先在 PR 评论 /skill-review',
    );
  } else {
    const match = REVIEW_COMMIT_RE.exec(latest.body ?? '');
    if (!match) {
      failures.push('最新技能评审评论里找不到「评审 commit」，无法核对 head');
    } else {
      const reviewedSha = match[1].toLowerCase();
      const headSha = pr.headRefOid.toLowerCase();
      if (!headSha.startsWith(reviewedSha)) {
        failures.push(
          `最新评审针对 ${reviewedSha}，当前 head 是 ${headSha}：必须对当前 head 重新触发 /skill-review`,
        );
      } else {
        notes.push(`技能评审 commit ${reviewedSha} = 当前 head`);
      }
    }
  }
} else if (!(pr.body ?? '').includes('技能评审 N/A')) {
  failures.push(
    '改动不涉及 apps/**，但 PR 正文没有显式写「技能评审 N/A」：请补充后再合并',
  );
} else {
  notes.push('改动不涉及 apps/**，已按「技能评审 N/A」处理');
}

const reviewedFileCount = files.filter((file) =>
  REVIEWED_PATHS.some((prefix) => file.startsWith(prefix)),
).length;

console.log(
  `PR #${prNumber} → ${pr.baseRefName} @ ${pr.headRefOid.slice(0, 7)}`,
);
console.log(
  `状态: ${pr.state}${pr.isDraft ? ' (draft)' : ''} / mergeStateStatus=${pr.mergeStateStatus}`,
);
console.log(
  `变更: ${files.length} 个文件（涉及 apps/** 的 ${reviewedFileCount} 个）`,
);
console.log(
  `CI: ${checks.length - badChecks.length}/${checks.length} 通过${
    badChecks.length ? `（${badChecks.length} 个未通过）` : ''
  }`,
);
for (const note of notes) console.log(`✓ ${note}`);

if (failures.length > 0) {
  console.error('\n❌ 合并前置检查未通过：');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\n✅ 合并前置检查通过');
