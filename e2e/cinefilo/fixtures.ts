import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import { handle } from '../../apps/relay/src/handler.ts';
import { sqliteStore, type TestStore } from '../../apps/relay/test/sqliteStore.ts';

/**
 * In-memory relay (same pattern as lector's fixtures/relay.ts): `/api/v1/spaces/**` is answered by the real
 * relay `handle()` over in-memory SQLite, shared by every context of a test. Any other `/api` call is aborted
 * and fails the test. The cinefilo app serves on :4174.
 */
export interface Relay {
  store: TestStore;
  install(context: BrowserContext): Promise<void>;
  requests(): string[];
}

function createRelay(): { api: Relay; unmatched: string[] } {
  const store = sqliteStore();
  const seen: string[] = [];
  const unmatched: string[] = [];

  async function onRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^\/api\/v1\/spaces\//.test(url.pathname)) {
      unmatched.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    seen.push(`${request.method()} ${url.pathname}`);
    const body = request.postData();
    const res = await handle(
      new Request(url, {
        method: request.method(),
        headers: await request.allHeaders(),
        ...(body !== null && request.method() !== 'GET' ? { body } : {}),
      }),
      store,
      () => Date.now(),
    );
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    await route.fulfill({ status: res.status, headers, body: await res.text() });
  }

  return {
    api: { store, install: (c) => c.route(/\/api\//, onRoute), requests: () => [...seen] },
    unmatched,
  };
}

async function newDevice(browser: Browser, relay: Relay, baseURL: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    serviceWorkers: 'allow',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  await relay.install(context);
  return { context, page: await context.newPage() };
}

export const test = base.extend<{ relay: Relay; newDevice: () => Promise<{ context: BrowserContext; page: Page }> }>({
  relay: [
    async ({ context }, use) => {
      const { api, unmatched } = createRelay();
      await api.install(context);
      await use(api);
      if (unmatched.length > 0) throw new Error(`Unrouted /api requests:\n${unmatched.join('\n')}`);
    },
    { auto: true },
  ],
  // Extra devices (own storage) sharing this test's relay.
  newDevice: async ({ browser, relay, baseURL }, use) => {
    const made: BrowserContext[] = [];
    await use(async () => {
      const d = await newDevice(browser, relay, baseURL!);
      made.push(d.context);
      return d;
    });
    for (const c of made) await c.close();
  },
});

export { expect };

export async function openApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('ready')).toBeAttached();
}

/** First run: start a shared list as `name` and continue past the code screen. Returns the sync code. */
export async function startList(page: Page, name: string): Promise<string> {
  await openApp(page);
  await page.getByRole('button', { name: 'Start a shared list' }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create the list' }).click();
  const code = (await page.getByTestId('sync-code').textContent()) ?? '';
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  return code;
}

export async function addByHand(page: Page, o: { title: string; kind?: 'Movie' | 'Series'; year?: string; status?: string }): Promise<void> {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a title' });
  await sheet.getByLabel('Title').fill(o.title);
  if (o.kind) await sheet.getByRole('button', { name: o.kind }).click();
  if (o.year) await sheet.getByLabel('Year').fill(o.year);
  if (o.status) await sheet.getByLabel('Status').selectOption({ label: o.status });
  await sheet.getByRole('button', { name: 'Add title' }).click();
  await expect(sheet).toBeHidden();
}

export const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name });
