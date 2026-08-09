import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 在 openapi-typescript 生成的契约文件头部加 eslint-disable，
// 避免 lint --fix / prettier 改写生成代码导致与 typegen 输出漂移（幂等：已带则不重复加）
const out = fileURLToPath(
  new URL('../src/generated/openapi.ts', import.meta.url),
);

const content = readFileSync(out, 'utf8');
if (!content.startsWith('/* eslint-disable */')) {
  writeFileSync(out, `/* eslint-disable */\n${content}`);
}
