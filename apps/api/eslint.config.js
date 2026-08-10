const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

/**
 * Flat config for the API. ESLint 9 dropped `.eslintrc`, and no replacement was
 * ever added — `bun run lint:api` failed to start at all, so the CI lint job
 * could never be green and no lint finding here was trustworthy.
 *
 * Scoped deliberately to correctness rules that hold across the existing code.
 * Type-aware linting (`parserOptions.project`) is not enabled: it would need a
 * separate tsconfig that includes the `*.spec.ts` files the build config
 * excludes, and it roughly triples lint time for rules this codebase does not
 * currently rely on.
 */
module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'eslint.config.js'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'writable',
        require: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        crypto: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // TypeScript already reports genuinely undefined identifiers, and the
      // decorator metadata NestJS relies on confuses the base rule.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      // Catches `if (a = b)` and unreachable code — the class of mistake worth
      // failing a build over.
      'no-cond-assign': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-self-compare': 'error',
      'no-unsafe-finally': 'error',
      'require-atomic-updates': 'off',
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    // Specs run under `bun test`, which supplies its own globals.
    files: ['**/*.spec.ts', 'src/test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        mock: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
