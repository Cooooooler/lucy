import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// 仅供 gen:openapi 脚本使用：SWC 转换装饰器元数据（esbuild 不输出 design:paramtypes）
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.spec.ts'],
  },
});
