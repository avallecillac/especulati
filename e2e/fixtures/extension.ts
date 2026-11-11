import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { test as relayTest, expect } from './relay.ts';
import { openApp } from '../helpers.ts';

/**
 * Feature 005 (T012): the unpacked extension, test build (`EXT_E2E=1`, localhost host_permissions,
 * so the tests need no activeTab gesture and no permission prompt) in a persistent context, next to
 * a normal "PWA" context. Both are routed to the same in-memory relay. Fixture article pages are
 * served with a route on localhost, never the network.
 */
export const APP_ORIGIN = 'http://localhost:4173';
export const ARTICLE_URL = `${APP_ORIGIN}/fixture/article.html`;
const DIST = fileURLToPath(new URL('../../apps/lector-extension/dist-e2e/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../apps/lector-extension/test/fixtures/', import.meta.url));
const localChromium = process.env['PLAYWRIGHT_BROWSERS_PATH'] ? '/opt/pw-browsers/chromium' : undefined;

/** The page every capture test uses: an English news article, about 650 words (~3 min). */
export const ARTICLE = { file: '01-news-en.html', title: 'City Council Approves New Bike Lanes', minutes: 3 };

export interface Extension {
  context: BrowserContext;
  sw: Worker;
  id: string;
  /** Open the fixture article in a new tab of the extension's browser. */
  openArticle(url?: string): Promise<Page>;
  /** Run the capture the way the toolbar action does, for the tab showing `url`. */
  capture(how: 'action' | 'command' | 'menu', url?: string): Promise<void>;
  /** Save the page's selection the way the shortcut or the context menu does, for the tab showing `url`. */
  highlight(how: 'command' | 'menu', url?: string): Promise<void>;
  /** Save for later the way the shortcut, the context menu (page) or the menu on a link does. */
  save(how: 'command' | 'menu' | 'link', opts?: { url?: string; linkUrl?: string }): Promise<void>;
  /** Options page: address and sync code, Pair. */
  pair(code: string): Promise<Page>;
  waiting(): Promise<number>;
  /** Wait until the background push has sent everything (nothing waiting). */
  sent(): Promise<void>;
  /** The toolbar badge text. */
  badge(): Promise<string>;
}

interface ChromeInSw {
  chrome: { action: { getBadgeText(o: object): Promise<string> }; tabs: { query(q: { url: string }): Promise<unknown[]> } };
}

export const test = relayTest.extend<{ ext: Extension; pwa: Page }>({
  ext: async ({ relay }, use) => {
    // Without this, Playwright does not route requests made by service workers, so the extension's
    // relay calls would miss the test relay. Read when a service worker starts.
    process.env['PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS'] = '1';
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rl-ext-')), {
      ...(localChromium ? { executablePath: localChromium } : {}),
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
      timezoneId: 'America/New_York',
      locale: 'en-US',
      reducedMotion: 'reduce',
    });
    await relay.install(context);
    const html = readFileSync(`${FIXTURES}${ARTICLE.file}`, 'utf8');
    await context.route(/\/fixture\//, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(sw.url()).host;

    const ext: Extension = {
      context,
      sw,
      id,
      async openArticle(url = ARTICLE_URL) {
        const page = await context.newPage();
        await page.goto(url);
        return page;
      },
      async capture(how, url = ARTICLE_URL) {
        await sw.evaluate(
          async ([h, u]) => {
            const [tab] = await (globalThis as unknown as ChromeInSw).chrome.tabs.query({ url: u! });
            const r = (globalThis as unknown as { lector: Record<string, (...a: unknown[]) => Promise<void>> }).lector;
            if (h === 'action') await r['captureTab']!(tab);
            else if (h === 'command') await r['onCommand']!('log-as-read', tab);
            else await r['onMenuClick']!({ menuItemId: 'log-as-read' }, tab);
          },
          [how, url],
        );
      },
      async highlight(how, url = ARTICLE_URL) {
        await sw.evaluate(
          async ([h, u]) => {
            const [tab] = await (globalThis as unknown as ChromeInSw).chrome.tabs.query({ url: u! });
            const r = (globalThis as unknown as { lector: Record<string, (...a: unknown[]) => Promise<void>> }).lector;
            if (h === 'command') await r['onCommand']!('save-highlight', tab);
            else await r['onMenuClick']!({ menuItemId: 'save-highlight' }, tab);
          },
          [how, url],
        );
      },
      async save(how, opts = {}) {
        await sw.evaluate(
          async ([h, u, link]) => {
            const [tab] = await (globalThis as unknown as ChromeInSw).chrome.tabs.query({ url: u! });
            const r = (globalThis as unknown as { lector: Record<string, (...a: unknown[]) => Promise<void>> }).lector;
            if (h === 'command') await r['onCommand']!('save-for-later', tab);
            else if (h === 'menu') await r['onMenuClick']!({ menuItemId: 'save-later' }, tab);
            else await r['onMenuClick']!({ menuItemId: 'save-later', linkUrl: link }, tab);
          },
          [how, opts.url ?? ARTICLE_URL, opts.linkUrl ?? ''],
        );
      },
      async pair(code) {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${id}/options.html`);
        await page.getByLabel('Readerlog address').fill(APP_ORIGIN);
        await page.getByLabel('Sync code').fill(code);
        await page.getByRole('button', { name: 'Pair' }).click();
        await expect(page.getByText('Paired', { exact: true })).toBeVisible();
        return page;
      },
      sent: () => expect.poll(() => ext.waiting()).toBe(0),
      badge: () => sw.evaluate(() => (globalThis as unknown as ChromeInSw).chrome.action.getBadgeText({})),
      waiting: () => sw.evaluate(async () => (await (globalThis as unknown as { lector: { status(): Promise<{ waiting: number }> } }).lector.status()).waiting),
    };
    await use(ext);
    await context.close();
    delete process.env['PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS'];
  },

  /** A normal PWA context on the same relay, with sync turned on. */
  pwa: async ({ browser, relay }, use) => {
    const context = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: 'allow', timezoneId: 'America/New_York', locale: 'en-US', reducedMotion: 'reduce' });
    await relay.install(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

/** Settings, Sync, Turn on sync. Returns the code. */
export async function turnOnSync(page: Page): Promise<string> {
  await openApp(page, '#/settings');
  await page.getByRole('link', { name: 'Sync settings' }).click();
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(page.getByRole('img', { name: 'Sync code QR' })).toBeVisible();
  return ((await page.getByTestId('sync-code').textContent()) ?? '').trim();
}

/** Home, Sync now, then Library, Articles. */
export async function syncAndOpenArticles(page: Page): Promise<void> {
  await page.goto('/#/');
  const button = page.getByRole('button', { name: 'Sync now' });
  await button.click();
  await expect(button).toBeEnabled();
  await page.goto('/#/library');
  await page.getByRole('tab', { name: 'Articles' }).click();
}

export { expect };
