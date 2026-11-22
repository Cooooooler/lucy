import { defineConfig } from 'vite';
import {
  createRendererPlugins,
  normalizeDevNodeEnv,
  rendererChunkSizeWarningLimit,
  rendererOptimizeDeps,
  rendererProxy,
  rendererResolve,
} from './vite.shared.ts';

export default defineConfig(({ command }) => {
  if (command === 'serve') normalizeDevNodeEnv();

  return {
    plugins: createRendererPlugins(),
    resolve: rendererResolve,
    optimizeDeps: rendererOptimizeDeps,
    build: {
      chunkSizeWarningLimit: rendererChunkSizeWarningLimit,
      rolldownOptions: {
        output: {
          // rolldown 自动处理代码分割，无需手动配置 manualChunks
        },
      },
    },
    server: {
      proxy: rendererProxy,
    },
  };
});
