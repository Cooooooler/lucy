import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild 不输出 design:paramtypes，NestJS DI 依赖该元数据，故用 SWC 转换
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: false,
    allowOnly: false,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/**/*.module.ts',
        // 纯类型/接口与选项类型没有运行时代码，计入覆盖率只会让报表出现 0% 假缺口
        'src/options.ts',
        'src/storage/storage-driver.interface.ts',
        '**/*.d.ts',
      ],
      // 全局 80 是合并门禁下限
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90,
      },
    },
  },
});
