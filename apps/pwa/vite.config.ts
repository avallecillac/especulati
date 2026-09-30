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
        // Latin font subsets are precached; Latin Extended loads on demand and is cached then (006 research R1).
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,webmanifest}', 'fonts/*-latin-wght-*.woff2'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/fonts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'readerlog-fonts', expiration: { maxEntries: 16 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Readerlog',
        short_name: 'Readerlog',
        description: 'Log books and articles; see your reading days.',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        background_color: '#f3ecdd',
        theme_color: '#f3ecdd',
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
