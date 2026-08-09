import js from '@eslint/js';
import reactDom from 'eslint-plugin-react-dom';
import reactX from 'eslint-plugin-react-x';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { parser as tsParser } from 'typescript-eslint';
import base from '../../eslint.base.mjs';

export default defineConfig([
  // 全局忽略
  globalIgnores(['dist', 'node_modules', '*.config.*']),

  // 基础JS推荐规则
  js.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parser: tsParser,
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

  // prettier 集成（来自根公共配置）
  ...base,
]);
