import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { core, prettier } from '../../eslint.base.mjs';

export default defineConfig([
  globalIgnores(['out', 'node_modules']),

  ...core,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
  },

  ...prettier,
]);
