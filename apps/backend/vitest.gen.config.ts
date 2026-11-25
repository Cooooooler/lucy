import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const testDir = fileURLToPath(new URL('./test', import.meta.url));

// 仅供 gen:openapi 脚本使用：SWC 转换装饰器元数据（esbuild 不输出 design:paramtypes）
export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      '@test': testDir,
    },
  },
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    allowOnly: false,
    include: ['test/tooling/**/*.spec.ts'],
    // 生成脚本会 compile AppModule，同样受 env schema 的两个 required 项约束。
    // 不挂这份 setup 时，`pnpm typegen` 在没有 apps/backend/.env 的机器上（CI、干净检出）必然失败。
    setupFiles: ['./test/support/setup.ts'],
  },
});
