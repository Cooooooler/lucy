export default {
  // --no-warn-ignored：各包的 eslint config 会忽略 *.config.*，但 lint-staged 仍会把
  // 它们喂进来；忽略提示不是问题，没必要在每次提交时刷屏。
  '*.{ts,tsx,js,jsx,mjs,cjs}': 'eslint --fix --no-warn-ignored',
  '*.{json,md,css,yml,yaml,html,svg}': 'prettier --ignore-unknown --write',
};
