import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const testDir = fileURLToPath(new URL('./test', import.meta.url));

export default defineConfig({
  // 测试已集中到 test/，用别名替代一长串 ../../../src
  resolve: {
    alias: {
      '@': srcDir,
      '@test': testDir,
    },
  },
  // esbuild 不输出 design:paramtypes，NestJS DI 依赖该元数据，故用 SWC 转换
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    // 提交 it.only 会让 CI 只跑一个用例却仍然全绿；这里直接禁用（Vitest 默认允许）
    allowOnly: false,
    include: ['test/unit/**/*.spec.ts'],
    setupFiles: ['./test/support/setup.ts'],
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
        // 只把真正只做转发的控制器排除在覆盖率门禁外（其行为由 e2e 覆盖），
        // 否则每加一个端点就得补一条纯委托断言，正是测试规模膨胀的来源。
        // ai / health / auth 控制器承载 SSE 状态机、停机探活与 cookie 语义，仍计入覆盖率。
        // Sonar 侧在 sonar.coverage.exclusions 排除同样这四个文件。
        'src/app.controller.ts',
        'src/knowledge/knowledge.controller.ts',
        'src/model-provider/model-provider.controller.ts',
        'src/users/users.controller.ts',
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
          functions: 80,
          branches: 85,
          statements: 88,
        },
        // 凭据哈希与令牌撤销同为安全关键，不能只靠全局地板
        'src/password/**': {
          lines: 95,
          functions: 95,
          branches: 95,
          statements: 95,
        },
        'src/redis/**': {
          lines: 90,
          functions: 90,
          branches: 70,
          statements: 90,
        },
        'src/model-provider/**': {
          lines: 88,
          functions: 80,
          branches: 85,
          statements: 88,
        },
        'src/users/**': {
          lines: 88,
          functions: 80,
          branches: 85,
          statements: 88,
        },
        // 探活是停机/降级路径的对外契约：全局 80 之外单独兜底，避免整块被删后仍靠胶水层撑住
        'src/health/**': {
          lines: 80,
          functions: 70,
          branches: 65,
          statements: 80,
        },
      },
    },
  },
});
