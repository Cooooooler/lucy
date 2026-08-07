import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import base from '../../eslint.base.mjs';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // 全局忽略
  globalIgnores(['dist', 'node_modules', '*.config.*']),

  // 基础JS推荐规则
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

  // prettier 集成（来自根公共配置）
  ...base,
]);
