import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Shown in Settings, so you can tell which deployed build is running.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    svelte(),
    VitePWA({
      // Never reload mid-log: the app shows "Update available" instead (research R4).
      registerType: 'prompt',
      strategies: 'generateSW',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Readerlog',
        short_name: 'Readerlog',
        description: 'Log books and articles; see your reading days.',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        background_color: '#fbfaf7',
        theme_color: '#2f5d50',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022' },
});
