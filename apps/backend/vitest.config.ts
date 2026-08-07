import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild 不输出 design:paramtypes，NestJS DI 依赖该元数据，故用 SWC 转换
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.module.ts',
        'src/**/*.decorator.ts',
        'src/db/migrations/**',
        'src/db/data-source.ts',
        'src/main.ts',
        'src/**/dto/**',
        '**/*.d.ts',
      ],
    },
  },
});
