# pnpm Monorepo 中 ESLint Flat Config 分层治理最佳实践

> 在 pnpm monorepo 中，ESLint 的最佳实现是基于 **ESLint Flat Config**（新版扁平配置 `eslint.config.js`）的"分层治理"模式。

---

## 一、核心逻辑

在根目录定义全局通用的基础规则、解析器和插件，在各个子包（packages）中根据业务特性（如 React、Vue、Node 等）引入并扩展这些基础规则，利用 Flat Config 独有的组合特性实现丝滑的配置共享。

**Flat Config 时代的优势：**

- 不再需要折腾旧版的 `extends`、`root: true` 或依赖隐式查找
- 配置即代码，通过 `import` / 数组展开实现组合与覆盖
- 所有 lint 依赖统一安装在根目录，子包保持干净，避免版本冲突

---

## 二、最佳实践目录结构

```text
monorepo-root/
├── packages/
│   ├── app-react/
│   │   ├── eslint.config.js   # 引入根目录配置并进行 React 扩展
│   │   └── package.json
│   └── utils-shared/
│       ├── eslint.config.js   # 引入根目录配置并进行纯 TS 扩展
│       └── package.json
├── eslint.config.js           # 全局基础配置（所有包公用）
├── package.json               # 根目录，安装主 eslint 依赖
└── pnpm-workspace.yaml
```

---

## 三、核心配置实现三步走

### 第一步：根目录安装基础依赖

所有 lint 相关的依赖（包括插件和解析器）统一安装在根目录。

```bash
pnpm add eslint tseslint eslint-plugin-prettier -D -w
```

> `tseslint` 是 [typescript-eslint.io](https://typescript-eslint.io/) 官方推荐的新版 Flat Config 工具包。

### 第二步：配置根目录 `eslint.config.js`

根目录负责拦截通用代码库，提供最大公约数的配置（全局忽略、通用 JS/TS 规则、Prettier 格式化等）。

```javascript
// eslint.config.js (根目录)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // 1. 全局忽略（相当于旧版 .eslintignore）
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },

  // 2. 继承官方推荐的 JS/TS 基础规则
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3. 通用规则微调
  {
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
      '@typescript-eslint/no-explicit-any': 'off', // 允许 TS 中临时使用 any
    },
  },

  // 4. 接入 Prettier 规避冲突（放最后）
  prettier,
);
```

### 第三步：子包按需继承与扩展

在子包中，通过 `import` 引入根目录配置，然后使用扁平配置的数组展开语法进行覆盖。

**React 子包示例（`packages/app-react/eslint.config.js`）：**

```javascript
// packages/app-react/eslint.config.js
import baseConfig from '../../eslint.config.js'; // 引入根配置
import reactPlugin from 'eslint-plugin-react';

export default [
  ...baseConfig, // 1. 展开根配置

  // 2. 增加当前 React 包特有的配置
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off', // React 17+ 不需要显式引入 React
    },
  },
];
```

**纯 TS 工具包子包（`packages/utils-shared/eslint.config.js`）：**

直接复用根配置即可，无需额外扩展：

```javascript
import baseConfig from '../../eslint.config.js';

export default [...baseConfig];
```

---

## 四、工程化配套

光写好配置文件还不够，monorepo 的真正痛点在于**校验速度**和**规范落地**。

### 1. 提速：配合 Turborepo 实现增量构建与缓存

如果直接用 `eslint packages/**` 会非常慢。推荐利用 [Turborepo](https://turbo.build/) 开启缓存，没改过的包瞬间通过。

**每个子包的 `package.json` 包含独立脚本：**

```json
{
  "scripts": {
    "lint": "eslint ."
  }
}
```

**根目录 `turbo.json` 配置：**

```json
{
  "pipeline": {
    "lint": {
      "outputs": [] // 利用缓存，没改过的包瞬间通过
    }
  }
}
```

**根目录执行：**

```bash
pnpm turbo run lint
```

### 2. 拦截：集成 Husky + lint-staged 实现提交前卡点

确保脏代码不会被提交到代码仓库。

**根目录安装：**

```bash
pnpm add husky lint-staged -D -w
```

**根目录 `.lintstagedrc.json` 配置：**

```json
{
  "packages/**/*.{js,ts,tsx}": ["eslint --fix"]
}
```

**Husky 前置钩子（`.husky/pre-commit`）：**

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec lint-staged
```

---

## 五、总结

| 层级 | 职责 | 关键文件 |
| --- | --- | --- |
| 根目录 | 全局通用规则、解析器、插件、忽略项 | `eslint.config.js` |
| 子包 | 按业务特性扩展（React / Vue / Node / 纯 TS） | `packages/*/eslint.config.js` |
| 提速层 | 增量缓存，避免全量 lint | `turbo.json` + `pnpm turbo run lint` |
| 拦截层 | 提交前自动修复，守住代码规范 | `husky` + `lint-staged` |

通过"根目录统一定义 + 子包按需扩展 + 工程化提速与拦截"的四层架构，可以在 pnpm monorepo 中实现既灵活又高效的 ESLint 治理体系。
