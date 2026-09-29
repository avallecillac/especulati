import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', root: 'packages/core', environment: 'node' } },
      { test: { name: 'db', root: 'packages/db', environment: 'node' } },
      { test: { name: 'sync', root: 'packages/sync', environment: 'node', passWithNoTests: true } },
      {
        test: {
          name: 'relay',
          root: 'apps/relay',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          passWithNoTests: true,
        },
      },
      {
        test: { name: 'pwa', root: 'apps/pwa', environment: 'node', include: ['src/**/*.test.ts'] },
      },
    ],
  },
});
