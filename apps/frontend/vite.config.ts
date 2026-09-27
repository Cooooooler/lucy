import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  // 外部 shell / CI 容器 / IDE 可能带着 NODE_ENV=production。Vite 以
  // `DEV = !(NODE_ENV === 'production')` 推导 import.meta.env.DEV，于是 `vite dev` 下
  // `src/api/client.ts` 会走 `/${API_VERSION}/` 而不是经 vite proxy 的 `/api/v${API_VERSION}/`，
  // 请求落到 SPA fallback 上变成 404（登录、列表全挂）。
  // `vite dev` 语义上就是开发环境，这里把 NODE_ENV 钉回 development；
  // 仅处理 serve，`vite build` 的 production 语义保持原样。
  if (command === 'serve' && process.env.NODE_ENV === 'production') {
    console.warn(
      '[vite] 检测到 NODE_ENV=production 与 vite dev 冲突：已为本次 dev server 改为 development（否则前端会绕过 /api 代理）。',
    );
    process.env.NODE_ENV = 'development';
  }
  return {
    plugins: [
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
    ],
    resolve: {
      tsconfigPaths: true,
    },
    optimizeDeps: {
      include: [
        'lucide-react',
        '@ant-design/icons',
        '@ant-design/pro-components',
      ],
    },
    build: {
      rolldownOptions: {
        output: {
          // rolldown 自动处理代码分割，无需手动配置 manualChunks
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          rewrite: (path) => path.replace('/api', ''),
          changeOrigin: true,
        },
      },
    },
  };
});
