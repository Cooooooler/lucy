import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import base from '../../eslint.base.mjs';

export default defineConfig([
  // docs/.vitepress 为 VitePress 站点源码，不在 src tsconfig 项目内，跳过（lint-staged 会喂给 eslint）
  globalIgnores(['dist', 'node_modules', '*.config.*', 'docs/**']),

  js.configs.recommended,

  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  ...base,
]);
