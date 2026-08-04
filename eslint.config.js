import js from '@eslint/js';
import base from './eslint.base.mjs';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // 全局忽略（配置文件自身）
  globalIgnores(['eslint.config.js', 'eslint.base.mjs']),

  // 基础JS推荐规则
  js.configs.recommended,

  // prettier 集成
  ...base,
]);
