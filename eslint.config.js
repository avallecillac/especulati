import tseslint from 'typescript-eslint';

const impureInCore = [
  { object: 'Date', property: 'now', message: 'core is pure: the shell passes `now` (constitution IV)' },
  { object: 'Math', property: 'random', message: 'core is pure: no randomness (constitution IV)' },
  { object: 'crypto', property: 'randomUUID', message: 'core is pure: ids come inside commands (constitution IV)' },
];
const shellGlobals = ['window', 'document', 'self', 'fetch', 'navigator', 'localStorage', 'indexedDB', 'setTimeout', 'setInterval'];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/dist-e2e/**', '**/test-results/**', '**/playwright-report/**', '**/*.svelte', '.specify/**', '.claude/**'] },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['vitest.config.ts'] }, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/lector-core/src/**/*.ts', 'packages/cinefilo-core/src/**/*.ts', 'packages/sync-core/src/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...impureInCore],
      'no-restricted-globals': ['error', ...shellGlobals],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: 'core is pure: no `new Date()`' }],
    },
  },
  {
    files: ['**/test/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
