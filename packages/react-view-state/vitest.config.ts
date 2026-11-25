import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // React 19 的 act() 仅在 development 构建导出；外部 NODE_ENV=production 时
    // @testing-library/react 会因没有 act 直接报错（与 frontend 的 vitest 配置同因）
    env: {
      NODE_ENV: 'test',
    },
    environment: 'jsdom',
    globals: false,
    allowOnly: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // index.ts 是纯 re-export；测试与测试环境桩不计覆盖率
      exclude: [
        'src/index.ts',
        'src/test-setup.ts',
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
