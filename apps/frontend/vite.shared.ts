import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';

/**
 * 渲染进程的 Vite 配置片段。
 *
 * 一份插件/别名/代理同时被两个入口消费：
 * - `vite.config.ts` —— 浏览器里的独立 Web 构建与 dev server；
 * - `apps/desktop/electron.vite.config.ts` —— Electron 的 renderer 构建。
 * 抽到这里是为了避免两边各写一份插件顺序（TanStack Router → React → React Compiler
 * → Tailwind）后静默漂移。
 */
// 返回类型刻意不标注 `PluginOption[]`：该文件同时被 root 的 vite 与 apps/desktop
// 安装的 vite 副本消费，两份 `vite` 类型实例互不兼容（ProxyOptions 内含私有成员）。
// 结构化推断可同时被两处接受。
export function createRendererPlugins() {
  return [
    // autoCodeSplitting：把每个路由组件的 component/pendingComponent 等非关键选项
    // 拆成独立 chunk，首屏只加载入口 + 当前路由（beforeLoad 守卫等关键选项仍随路由文件
    // 同步加载，登录态判定不会被推迟）。此前全部路由静态引入，重依赖（ogl/gsap/antd-x/
    // pro-components）全落进单一入口 chunk（实测 gzip 破 1MB）。
    tanstackRouter({
      routeFileIgnorePattern: '.*\\.test\\.tsx$',
      autoCodeSplitting: true,
    }),
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ];
}

/** `@/*` → `./src/*` 由 Vite 8 读取 tsconfig 解析，无需额外插件 */
export const rendererResolve = {
  tsconfigPaths: true,
};

export const rendererOptimizeDeps = {
  include: ['lucide-react', '@ant-design/icons', '@ant-design/pro-components'],
};

/**
 * 路由级 autoCodeSplitting 已生效；antd/pro-components 的懒加载路由块压缩后
 * 单体仍会 >500kB（Table 约 690kB，gzip 约 214kB），属预期体积。
 * Web 与 Electron 构建共用这个阈值，避免每次构建都刷无意义的 chunk-size 告警。
 */
export const rendererChunkSizeWarningLimit = 1700;

/**
 * `/api` → 后端（浏览器 dev / Electron renderer dev 共用）。
 * 走代理让渲染进程只看见同源，因此刷新令牌的 HttpOnly cookie 天然生效，也不触发 CORS。
 */
export const rendererProxy = {
  '/api': {
    target: 'http://localhost:3000',
    rewrite: (path: string) => path.replace('/api', ''),
    changeOrigin: true,
  },
};

/**
 * 外部 shell / CI 容器 / IDE 可能带着 NODE_ENV=production。Vite 以
 * `DEV = !(NODE_ENV === 'production')` 推导 import.meta.env.DEV，于是 dev server 下
 * `src/api/client.ts` 会走 `/${API_VERSION}/` 而不是经代理的 `/api/v${API_VERSION}/`，
 * 请求落到 SPA fallback 上变成 404（登录、列表全挂）。
 * dev server 语义上就是开发环境，这里把 NODE_ENV 钉回 development；
 * 仅用于 serve，构建的 production 语义保持原样。
 */
export function normalizeDevNodeEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[vite] 检测到 NODE_ENV=production 与 dev server 冲突：已为本次 dev server 改为 development（否则前端会绕过 /api 代理）。',
    );
    process.env.NODE_ENV = 'development';
  }
}
