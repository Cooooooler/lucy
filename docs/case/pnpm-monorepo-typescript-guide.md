# pnpm Monorepo 中 TypeScript 分层治理最佳实践

> 在 pnpm monorepo 中，TypeScript 的最佳实践与 ESLint 类似，核心思想同样是"分层治理"。但 TS 与 ESLint 有一个关键差异： **TS无法通过简单的相对路径直接组合复杂配置**（`compilerOptions` 无法像 JS 数组那样丝滑地进行对象展开）。此外，Monorepo 中的 TS还必须解决子包之间本地互相引用时的"源码级实时跳转"以及增量编译速度问题。
>
> **2026 年社区最优方案：** 基础配置共享（Base extends）+ 共享类型定义包（可选）+ 现代打包工具（Rspack / Vite）或 TS 5.x 引用（Paths / Projects）。

---

## 一、核心差异：TS vs ESLint

| 维度         | ESLint Flat Config    | TypeScript                        |
| ------------ | --------------------- | --------------------------------- |
| 配置组合方式 | JS 数组展开，灵活组合 | `extends` 关键字，仅支持单层继承  |
| 对象展开     | ✅ 原生支持           | ❌ `compilerOptions` 无法部分展开 |
| 跨包类型同步 | 不涉及                | 需解决源码级实时跳转问题          |
| 推荐共享方式 | 可独立 npm 包发布     | 直接用根目录 `tsconfig.base.json` |

> **关键结论：** 不要像 ESLint 那样为 TS 建立一个独立的 npm 共享包，直接用根目录的 `tsconfig.base.json` 即可——因为 TS 的 `extends` 寻路机制完美支持相对路径。

---

## 二、最佳实践目录结构

```text
monorepo-root/
├── packages/
│   ├── app-web/              # 业务 Web 包（需要 DOM、React 等类型）
│   │   ├── tsconfig.json     # 继承全局配置，声明专属 compilerOptions
│   │   └── package.json
│   └── utils-shared/         # 纯 TS/JS 工具包（纯 Node/轻量环境）
│       ├── tsconfig.json     # 继承全局配置
│       └── package.json
├── tsconfig.base.json        # 核心：全局共享的 TS 编译选项（只放规则，不放路径）
├── tsconfig.json             # 根目录 TS 配置（用于给 IDE 识别整体项目结构）
├── package.json              # 全局安装 typescript 依赖
└── pnpm-workspace.yaml
```

---

## 三、核心配置实现三步走

### 第一步：根目录创建 `tsconfig.base.json`

将所有公共的、最严格的编译期检查规则抽离到根目录。子包通过 `extends` 继承，保证团队代码风格绝对统一。

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    // 现代 TS 强制显式 import type，避免打包工具副作用
    "skipLibCheck": true,
    /* 严格类型检查（建议全部开启） */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 第二步：子包继承与按需扩展

子包只需利用 `extends` 关键字指向根目录的 `tsconfig.base.json`，再按需定义各自的 `lib` 和 `jsx` 环境。

**前端 Web 包（`packages/app-web/tsconfig.json`）：**

```json
// packages/app-web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  // 继承公共底座
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    // Web 环境特有
    "jsx": "react-jsx",
    // React 特有
    "noEmit": true
    // 只用 TS 校验，编译交给 Vite/Rspack
  },
  "include": ["src/**/*"]
}
```

**纯工具包（`packages/utils-shared/tsconfig.json`）：**

```json
// packages/utils-shared/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    // 纯 JS 环境，不需要 DOM 类型
    "outDir": "./dist",
    "declaration": true
    // 需要生成 .d.ts 声明文件供其他包消费
  },
  "include": ["src/**/*"]
}
```

### 第三步：配置根目录 `tsconfig.json`（管家配置）

根目录的 `tsconfig.json` 主要负责告诉 VS Code 整个 Monorepo 应该怎么管理，让 IDE 能够在跨包调用时正确建立索引。

```json
// tsconfig.json (根目录)
{
  "files": [],
  // 根目录本身不编译任何代码
  "references": [
    {
      "path": "./packages/app-web"
    },
    {
      "path": "./packages/utils-shared"
    }
  ]
}
```

---

## 四、Monorepo 跨包引用的"丝滑跳转"解决方案

### 痛点

当 `app-web` 引用 `utils-shared` 时，最痛苦的是：修改了 utils 的代码，app 无法实时看到类型改变，必须先去 utils 目录运行`tsc` 编译一下。

### 2026 年最佳方案：pnpm 软链接 + `exports.types` 指向源码

无需配置复杂且缓慢的 `tsconfig paths`，直接利用 pnpm 软链接。

**步骤 1：在消费方声明兄弟包依赖**

`packages/app-web/package.json`：

```json
{
  "dependencies": {
    "@my-project/utils-shared": "workspace:*"
  }
}
```

**步骤 2：在被消费方配置 `exports` 字段**

`packages/utils-shared/package.json`：

```json
{
  "name": "@my-project/utils-shared",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      // 核心：开发阶段 IDE 和 TS 直接看源码！支持秒级跳转与实时类型报错
      "import": "./dist/index.js"
      // 生产或构建阶段打包工具用这个
    }
  }
}
```

### 为什么这样能实现"丝滑跳转"？

当把 `"types"` 直接指向 `./src/index.ts` 源码时，VS Code 会完全把它当成同一个项目内的代码来处理：

- 改动 utils 源码的瞬间，`app-web` 里的代码校验和自动补全就会跟着变
- 支持 `Cmd/Ctrl + Click` 直接跳转到兄弟包的源码定义
- 无需预先运行 `tsc` 编译，类型实时同步

> **对比传统方案：** 不需要在 `tsconfig.json` 里写又长又难维护的 `paths: { "@/*": [...] }`，也不需要配置 `tsconfig references` 的增量编译链路。

---

## 五、总结：TS 配置的关键闭环

| 层级 | 职责 | 关键文件 / 字段 |
| --- | --- | --- |
| 基础层 | 全局共享编译规则、严格类型检查 | `tsconfig.base.json` |
| 子包层 | 按需定义 `lib` / `jsx` / `outDir` 等环境差异 | `packages/*/tsconfig.json`（`extends` 继承） |
| 管家层 | IDE 项目索引、跨包引用识别 | 根目录 `tsconfig.json`（`references`） |
| 跳转层 | 跨包源码级实时类型同步 | `package.json` 的 `exports.types` → `src/index.ts` |

**三条核心原则：**

1. **所有子包各自继承基础配置**，按需定义各自的 `lib` 和 `jsx` 环境。
2. **依靠 `package.json` 的 `exports.types` 指向 `src/**/*.ts`** 解决 Monorepo 跨包开发的类型同步痛点，不需要在 `tsconfig.json` 里写又长又难维护的 `paths`。
