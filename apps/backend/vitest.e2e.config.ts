import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 与单测一致：SWC 提供 decorator metadata，AppModule 全链路 DI 需要
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
