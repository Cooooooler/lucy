import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    allowOnly: false,
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // generated/openapi.ts 是 openapi-typescript 产物（纯类型），已由 sonar.exclusions 排除
      exclude: ['src/**/*.spec.ts', 'src/generated/**', '**/*.d.ts'],
      // 全局 80 是合并门禁下限；当前实测均高于此值，留出合理重构余量
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
