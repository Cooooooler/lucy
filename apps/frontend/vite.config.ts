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
      tanstackRouter({ routeFileIgnorePattern: '.*\\.test\\.tsx$' }),
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
