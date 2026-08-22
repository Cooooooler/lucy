import reactDom from 'eslint-plugin-react-dom';
import reactX from 'eslint-plugin-react-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  // 全局忽略
  globalIgnores(['dist', 'node_modules', '*.config.*']),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，react-x/react-dom 不含 parser，由 core 提供）
  ...core,

  // React + react-dom 推荐规则（仅提供 plugin，parser 由 core 注册）
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
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Prettier 集成（收尾）
  ...prettier,
]);
