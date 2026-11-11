import { defineConfig, devices } from '@playwright/test';

// Chromium is preinstalled in the dev container (research R9); CI installs its own.
const localChromium = process.env['PLAYWRIGHT_BROWSERS_PATH'] ? '/opt/pw-browsers/chromium' : undefined;

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'allow',
    // Deterministic local dates that cross a UTC day boundary (research R6).
    timezoneId: 'America/New_York',
    locale: 'en-US',
    // Existing specs shouldn't click through view transitions; shell.spec.ts opts back in.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/cinefilo/**',
      use: {
        ...devices['Desktop Chrome'],
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
    {
      name: 'cinefilo',
      testMatch: 'cinefilo/**/*.spec.ts',
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://localhost:4174',
        ...(localChromium ? { launchOptions: { executablePath: localChromium } } : {}),
      },
    },
  ],
  webServer: [{
    command: 'pnpm --filter @especulati/lector-extension build:e2e && pnpm --filter lector build && pnpm --filter lector preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
  {
    command: 'pnpm --filter cinefilo build && pnpm --filter cinefilo preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  }],
});
