import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      // generated/openapi.ts 是 openapi-typescript 产物（纯类型），已由 sonar.exclusions 排除
      exclude: ['src/**/*.spec.ts', 'src/generated/**', '**/*.d.ts'],
    },
  },
});
