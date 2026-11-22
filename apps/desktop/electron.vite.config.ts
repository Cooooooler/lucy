import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import {
  createRendererPlugins,
  normalizeDevNodeEnv,
  rendererOptimizeDeps,
  rendererProxy,
  rendererResolve,
} from '../frontend/vite.shared.ts';

const frontendRoot = resolve(__dirname, '../frontend');

// 一次配置、三份独立构建（main / preload / renderer）。
// renderer 直接以 apps/frontend 为根：Electron 开发与 Web 开发共享同一套源码、
// 插件与 /api 代理，只有一个前端代码库。
export default defineConfig(({ command }) => {
  if (command === 'serve') normalizeDevNodeEnv();

  return {
    main: {
      build: {
        outDir: 'out/main',
      },
    },
    preload: {
      build: {
        outDir: 'out/preload',
      },
    },
    renderer: {
      root: frontendRoot,
      // electron-vite 默认 base './'（为 file:// 场景设计），但本应用始终从
      // http://127.0.0.1 的根路径加载：绝对 base 才能让 /knowledge/:id 这类
      // 嵌套路由刷新时正确回指 /assets/*。
      base: '/',
      plugins: [
        ...createRendererPlugins(),
        {
          // electron-vite 的 preset 在 `enforce: 'pre'` 里无条件把 base 改成 './'
          //（为 file:// 设计）。本应用通过本地 HTTP 从根路径加载，post 阶段改回 '/'
          // 才能让 /knowledge/:id 这类嵌套路由刷新时正确回指 /assets/*。
          name: 'lucy:renderer-absolute-base',
          config: () => ({ base: '/' }),
        },
      ],
      resolve: rendererResolve,
      optimizeDeps: rendererOptimizeDeps,
      server: {
        // 与 Web 端（5173）错开，避免同时运行时争用同一端口
        port: 5174,
        strictPort: true,
        proxy: rendererProxy,
      },
      build: {
        outDir: resolve(__dirname, 'out/renderer'),
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(frontendRoot, 'index.html'),
        },
      },
    },
  };
});
