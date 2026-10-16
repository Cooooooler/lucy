import { defineConfig, devices } from '@playwright/test';

/**
 * 前端 e2e（Playwright）。
 *
 * 与单测的分工：vitest 走 SWC、不跑 React Compiler，也拿不到真实渲染引擎，
 * 因此「编译期回调提升导致运行时 ReferenceError」「路由整页报错」这类缺陷单测拦不住
 * ——它们正是本套冒烟用例的目标（见 e2e/smoke.spec.ts 的说明）。
 *
 * 全程不依赖后端：spec 里在浏览器网络层拦掉所有 `/api/**`（含 `/v1/**`）请求并返回
 * 信封化假数据，所以不需要 DB / Redis / Nest 进程。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // 显式写 127.0.0.1 而非 localhost：vite 默认把 dev server 绑在 `[::1]`（IPv6），
    // 而 `localhost` 在 Node 里可能先解析到 IPv4 —— Playwright 的就绪探测会因此看不到
    // 已在跑的 server，转而自己再启一个并撞上「Port 5173 is already in use」。
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // 绑到 IPv4 后，本地已在跑的 IPv6 dev server 不再与之冲突；
    // 本地没跑 server 时（含 CI）由本配置自己拉起。
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
