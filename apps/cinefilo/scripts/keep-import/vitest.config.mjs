import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'keep-import', root: import.meta.dirname, environment: 'node', include: ['test/**/*.test.mjs'] },
});
