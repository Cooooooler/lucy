import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  // docs/.vitepress 为 VitePress 站点源码，不在 src tsconfig 项目内，跳过（lint-staged 会喂给 eslint）
  globalIgnores(['dist', 'node_modules', '*.config.*', 'docs/**']),

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

  // Prettier 集成（收尾）
  ...prettier,
]);
