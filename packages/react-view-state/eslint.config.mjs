import reactDom from 'eslint-plugin-react-dom';
import reactX from 'eslint-plugin-react-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  // docs/.vitepress 为 VitePress 站点源码，不在 src tsconfig 项目内，跳过（lint-staged 会喂给 eslint）
  globalIgnores(['dist', 'node_modules', 'coverage', '*.config.*', 'docs/**']),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，react-x/react-dom 不含 parser，由 core 提供）
  ...core,

  // React 推荐规则（与 apps/frontend 的 eslint 配置同源）
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Prettier 集成（收尾）
  ...prettier,
]);
