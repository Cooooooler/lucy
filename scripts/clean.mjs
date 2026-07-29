import { readdirSync, rmSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'dist',
  '.umi',
  '.umi-production',
  '.mfsu',
  '.swc',
  'coverage',
];
const workspaces = ['apps', 'packages'];

function clean(dir) {
  for (const name of targets) {
    const target = resolve(dir, name);
    try {
      rmSync(target, { recursive: true, force: true });
      console.log(`  cleaned: ${target}`);
    } catch {}
  }
}

clean(root);

for (const ws of workspaces) {
  const wsDir = resolve(root, ws);
  try {
    for (const entry of readdirSync(wsDir)) {
      const full = resolve(wsDir, entry);
      if (statSync(full).isDirectory()) {
        clean(full);
      }
    }
  } catch {}
}
