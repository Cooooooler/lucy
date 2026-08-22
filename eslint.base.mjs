import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

/**
 * core —— 必须先于包级 extends 展开。
 * 提供所有包共用的 JS 基础推荐规则与 TS 解析器/插件；
 * 类型感知规则仍由各包自己的 extends（tseslint / react-x）配置。
 */
export const core = [
  js.configs.recommended,
  {
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
    },
  },
];

/**
 * prettier —— 必须最后展开。
 * 关闭与 Prettier 冲突的格式类规则，并统一 TS 常见规则覆盖，
 * 确保包级 extends（tseslint / react-x）产生的规则在这里收敛一致。
 */
export const prettier = [
  eslintPluginPrettierRecommended,
  {
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_', // 忽略以 _ 开头的函数参数
          varsIgnorePattern: '^_', // 忽略以 _ 开头的局部变量
          caughtErrorsIgnorePattern: '^_', // 忽略 catch(_e) 里的错误参数
          destructuredArrayIgnorePattern: '^_', // 忽略解构数组中 _ 开头的项
          ignoreRestSiblings: true, // rest 解构时忽略被剔除的兄弟属性
          args: 'after-used', // 只检查「最后一个被使用参数」之后的参数
        },
      ],
    },
  },
];
