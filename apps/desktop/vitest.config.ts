import { defineConfig } from 'vitest/config';

/**
 * 桌面端（Electron 主进程）单测配置。
 *
 * 这里只测「纯 Node 可运行」的主进程模块：本地静态服务器/反代（server.ts）与
 * 安全策略（security.ts）。渲染进程的代码属于 apps/frontend，由那边的 suite 覆盖。
 */
export default defineConfig({
  test: {
    // 主进程代码不碰 DOM，全部用真实 fs / http
    environment: 'node',
    // 显式从 vitest 导入 describe/it/expect，避免额外注入全局类型
    globals: false,
    include: ['src/**/*.test.ts'],
    // CI 上出现 it.only 会静默吞掉其余用例，直接判失败
    allowOnly: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // 引导壳（bootstrap shell）：main/index.ts 在模块顶层就调用
        // app.requestSingleInstanceLock / whenReady / new BrowserWindow，
        // preload/index.ts 在模块顶层调用 contextBridge.exposeInMainWorld。
        // 两者必须在真实 Electron 运行时才有意义，放进单测只能把整个 electron
        // 模块 mock 掉，断言不到任何真实行为（等价于测试自己的 mock），因此排除；
        // 它们依赖的安全策略本身已由 security.test.ts 完整覆盖。
        'src/main/index.ts',
        'src/preload/index.ts',
        '**/*.d.ts',
      ],
      // 硬性门槛：四项均需 >= 80%
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
