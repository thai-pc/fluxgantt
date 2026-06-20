// @fluxgantt/eslint-config — flat config base (ESLint 9)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Shared FluxGantt config. Spread into a package's eslint.config.js. */
export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', '.turbo/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Branded ID + strict types: cấm any rò rỉ
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Core headless: cảnh báo sớm khi import sai layer được cấu hình ở từng package
      'no-restricted-imports': 'off',
    },
  },
);
