import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: ['**/node_modules', '**/dist', '**/coverage', '**/.perfect-front', '**/fixtures'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.mjs', 'scripts/**', 'packages/cli/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['scripts/**', 'packages/cli/**', 'apps/extension/scripts/**'],
    rules: { 'no-console': 'off' },
  },
];
