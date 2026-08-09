import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default [
  eslintPluginPrettierRecommended,
  {
    plugins: {
      '@typescript-eslint': tseslint.plugin, // 关键：注册插件
    },
    languageOptions: {
      parser: tseslint.parser, // TS 文件需要 TS 解析器
    },
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
