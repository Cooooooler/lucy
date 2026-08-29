import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // React 19 的 act() 仅在 development 构建导出；外部 NODE_ENV=production 时 react
    // 加载 production.js（无 act）会让 @testing-library/react 在 renderHook/render 时
    // 报 `React.act is not a function`。vitest 默认对 production 不做覆盖（视为用户
    // 显式选择），这里显式纠正。
    env: {
      NODE_ENV: 'test',
    },
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
      // 只统计有业务逻辑的模块；视觉特效/启动装配/生成代码/纯类型/纯重导出
      // 不纳入覆盖率
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/router.ts',
        'src/routeTree.gen.ts',
        // Tier3 / 富组件：非核心静态壳或富组件，hook 层已验，routes smoke 已覆盖
        'src/routes/__root.tsx',
        'src/routes/_auth.tsx',
        'src/routes/_layout.tsx',
        'src/routes/_layout/chat.tsx',
        'src/routes/_layout/knowledge.tsx',
        'src/components/ui/**',
        'src/components/bits/**',
        'src/backgrounds/**',
        'src/test/**',
        // 纯类型文件与目录索引（仅 re-export，无运行时逻辑）
        'src/api/types.ts',
        'src/theme/index.ts',
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
