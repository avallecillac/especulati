import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const e2e = process.env.EXT_E2E === '1';
const outDir = e2e ? 'dist-e2e' : 'dist';
// EXT_ENTRY selects one of the separately bundled, self-contained injected scripts
// (executeScript can't load ES-module chunks). Unset = service worker + options page.
const entry = process.env.EXT_ENTRY as 'extract' | 'toast' | undefined;

// Writes manifest.json into the output. The EXT_E2E test build adds localhost host
// permissions (research R3); the release manifest must have none (check-manifest.mjs).
function manifestPlugin(): Plugin {
  return {
    name: 'readerlog-manifest',
    apply: 'build',
    closeBundle() {
      const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      if (e2e) manifest.host_permissions = ['http://localhost/*', 'http://127.0.0.1/*'];
      const dir = resolve(import.meta.dirname, outDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  define: { __E2E__: JSON.stringify(e2e) },
  plugins: entry ? [] : [manifestPlugin()],
  build: {
    target: 'es2022',
    outDir,
    emptyOutDir: !entry,
    minify: false,
    modulePreload: false,
    ...(entry
      ? {
          lib: { entry: resolve(import.meta.dirname, `src/${entry}.ts`), formats: ['iife' as const], name: `readerlog_${entry}`, fileName: () => `${entry}.js` },
        }
      : {
          rollupOptions: {
            input: { sw: resolve(import.meta.dirname, 'src/sw.ts'), options: resolve(import.meta.dirname, 'options.html') },
            output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
          },
        }),
  },
});
