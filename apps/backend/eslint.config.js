import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  // 全局忽略
  globalIgnores(['dist', 'node_modules', '*.config.*']),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，须先于 extends 展开）
  ...core,

  // 后端类型感知规则（NestJS + vitest 全局，projectService 按需编译）
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // 后端允许临时 any（与前端/共享包默认 error 的行为区分）
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },

  // Prettier 集成（收尾）
  ...prettier,
]);
