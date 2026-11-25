import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild 不输出 design:paramtypes，NestJS DI 依赖该元数据，故用 SWC 转换
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./src/test/setup.ts'],
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
        'src/test/**',
        'src/**/dto/**',
        '**/*.d.ts',
      ],
      // 运行时真实覆盖率门禁（v8 记录实际执行行，不含 SonarCloud 误计的装饰器/注解行）
      //
      // 全局 80 只是地板。核心业务域单独抬高门槛，避免「删掉核心域测试、靠胶水层的
      // 高覆盖把平均值撑住」——那正是测试规模失控却门禁全绿的原因。取值略低于当前
      // 实测值，给合理重构留余量，但足以挡住整块测试被删。
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        'src/auth/**': { lines: 90, functions: 90, branches: 88, statements: 90 },
        'src/ai/**': { lines: 95, functions: 90, branches: 88, statements: 92 },
        'src/common/**': {
          lines: 92,
          functions: 90,
          branches: 80,
          statements: 92,
        },
        'src/knowledge/**': {
          lines: 88,
          functions: 70,
          branches: 85,
          statements: 88,
        },
        'src/model-provider/**': {
          lines: 88,
          functions: 75,
          branches: 85,
          statements: 88,
        },
        'src/users/**': {
          lines: 88,
          functions: 75,
          branches: 85,
          statements: 88,
        },
      },
    },
  },
});
