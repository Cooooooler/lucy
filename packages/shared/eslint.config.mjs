import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  // 全局忽略（生成代码 openapi.ts 为 openapi-typescript 产物，lint 不改写，与 typegen 输出保持漂移一致）
  globalIgnores(['dist', 'node_modules', '*.config.*', 'src/generated/**']),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，须先于 extends 展开）
  ...core,

  // 纯 TS 推荐规则（非类型感知）
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
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

  // Prettier 集成（收尾）
  ...prettier,
]);
