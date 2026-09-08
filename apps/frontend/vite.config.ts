import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { defineConfig } from 'vite';

export default defineConfig({
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
});
