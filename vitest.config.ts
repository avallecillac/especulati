import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', environment: 'node' } },
      { test: { name: 'db', root: 'packages/db', environment: 'node' } },
      {
        test: { name: 'pwa', root: 'apps/pwa', environment: 'node', include: ['src/**/*.test.ts'] },
      },
    ],
  },
});
