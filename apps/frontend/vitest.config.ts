import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@api': fileURLToPath(new URL('./src/api', import.meta.url)),
      '@bg': fileURLToPath(new URL('./src/backgrounds/index.ts', import.meta.url)),
      '@components': fileURLToPath(
        new URL('./src/components/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      // 只统计有业务逻辑的模块；视觉特效/启动装配/生成代码不纳入覆盖率
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/router.ts',
        'src/routeTree.gen.ts',
        'src/routes/**',
        'src/components/**',
        'src/backgrounds/**',
        'src/test/**',
        'src/**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
