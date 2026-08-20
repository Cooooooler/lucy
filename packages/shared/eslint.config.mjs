import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import base from '../../eslint.base.mjs';

export default defineConfig([
  // 全局忽略（生成代码 openapi.ts 为 openapi-typescript 产物，lint 不改写，与 typegen 输出保持漂移一致）
  globalIgnores(['dist', 'node_modules', '*.config.*', 'src/generated/**']),

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
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Node 脚本（scripts/）——js.configs.recommended 的 no-undef 需 node 全局
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // prettier 集成（来自根公共配置）
  ...base,
]);
