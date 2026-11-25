import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// 仅供 gen:openapi 脚本使用：SWC 转换装饰器元数据（esbuild 不输出 design:paramtypes）
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    allowOnly: false,
    include: ['scripts/**/*.spec.ts'],
    // 生成脚本会 compile AppModule，同样受 env schema 的两个 required 项约束。
    // 不挂这份 setup 时，`pnpm typegen` 在没有 apps/backend/.env 的机器上（CI、干净检出）必然失败。
    setupFiles: ['./src/test/setup.ts'],
  },
});
