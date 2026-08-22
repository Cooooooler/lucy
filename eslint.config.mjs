import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { core, prettier } from './eslint.base.mjs';

export default defineConfig([
  // 全局忽略（配置文件自身；openapi-typescript 生成代码用文件头 eslint-disable 排除）
  globalIgnores(['eslint.config.mjs', 'eslint.base.mjs']),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，须先于后续块展开）
  ...core,

  // 根目录 Node 脚本（scripts/）——js.configs.recommended 的 no-undef 需 node 全局
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // clean.mjs 等脚本用空 catch 块表达"忽略错误"，属有意为之
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Prettier 集成（收尾）
  ...prettier,
]);
