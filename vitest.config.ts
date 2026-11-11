import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'sync-core', root: 'packages/sync-core', environment: 'node' } },
      { test: { name: 'db-kit', root: 'packages/db-kit', environment: 'node' } },
      { test: { name: 'lector-core', root: 'packages/lector-core', environment: 'node' } },
      { test: { name: 'lector-db', root: 'packages/lector-db', environment: 'node' } },
      { test: { name: 'sync', root: 'packages/sync', environment: 'node' } },
      { test: { name: 'lector-sync', root: 'packages/lector-sync', environment: 'node' } },
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
        test: { name: 'lector', root: 'apps/lector', environment: 'node', include: ['src/**/*.test.ts'] },
      },
    ],
  },
});
