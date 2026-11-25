import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { core, prettier } from './eslint.base.mjs';

export default defineConfig([
  // 全局忽略：配置文件自身、构建/测试产物。
  // 产物目录必须显式排除——根目录是 workspace 之外的文件系统，`eslint .` 会一路扫进
  // 各包的 coverage/dist（生成代码，规则不适用，且会让报告被无关噪音淹没）。
  globalIgnores([
    'eslint.config.mjs',
    'eslint.base.mjs',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.turbo/**',
    '**/test-results/**',
    '**/playwright-report/**',
  ]),

  // 通用核心（JS 推荐规则 + TS 解析器/插件，须先于后续块展开）
  ...core,

  // 根目录 Node 脚本 —— js.configs.recommended 的 no-undef 需 node 全局。
  // 只覆盖根目录自身的文件（scripts/、*.config.js/.mjs）：
  // 各包内的脚本与源码由各包自己的 lint 任务负责（从根 lint 它们会命中包级配置，
  // 其 `projectService` 在找不到唯一 tsconfig 根时报错）。
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
      // lint-staged 会把多个包的 TS 文件与根脚本放进同一次 eslint 调用；ESLint 10 的
      // 配置查找会把包级 parserOptions.projectService 带进上下文，缺少 root 时会以
      // 「multiple candidate TSConfigRootDirs」直接报解析错误。显式钉到仓库根即可。
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // clean.mjs 等脚本用空 catch 块表达"忽略错误"，属有意为之
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Prettier 集成（收尾）
  ...prettier,
]);
