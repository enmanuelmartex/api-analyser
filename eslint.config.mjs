import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * A plain TypeScript config rather than `eslint-config-next`: this project has
 * no components, images or links, so every rule that config adds would be dead
 * weight over a folder of route handlers and libraries.
 */
export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Logging and provider payloads are genuinely dynamic in shape; the
      // boundaries that matter are typed, and `unknown` is used where it can be.
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
);
