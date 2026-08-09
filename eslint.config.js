import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import base from './eslint.base.mjs';

export default defineConfig([
  // 全局忽略（配置文件自身；openapi-typescript 生成代码用文件头 eslint-disable 排除）
  globalIgnores(['eslint.config.js', 'eslint.base.mjs']),

  // 基础JS推荐规则
  js.configs.recommended,

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

  // prettier 集成
  ...base,
]);
