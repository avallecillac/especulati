import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import { handle } from '../../apps/relay/src/handler.ts';
import { sqliteStore, type TestStore } from '../../apps/relay/test/sqliteStore.ts';
import { installFakeCamera, test as base, expect, type FakeCamera } from './catalog.ts';

/**
 * E2E relay for feature 004 (T013): `/api/v1/**` is answered by the real relay `handle()` over
 * an in-memory SQLite store, one per test and shared by every context. Any other `/api` call
 * is recorded, aborted and fails the test.
 */

export interface RelayFixture {
  store: TestStore;
  /** Routes `/api/**` for this context to the test relay. */
  install(context: BrowserContext): Promise<void>;
  /** `METHOD path` of every relay request seen (space ids included: test output only). */
  requests(): string[];
  /** Answer every relay request with this status until cleared (null). */
  failWith(status: number | null): void;
  /** `/api` calls that were not `/api/v1/spaces/**` (these fail the test). */
  unmatched(): string[];
}

function createRelay(): { api: RelayFixture; guardErrors: () => string[] } {
  const store = sqliteStore();
  const seen: string[] = [];
  const unmatched: string[] = [];
  let forced: number | null = null;

  async function onRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!/^\/api\/v1\/spaces\//.test(url.pathname)) {
      unmatched.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    seen.push(`${request.method()} ${url.pathname}${url.search}`);
    if (forced !== null) return route.fulfill({ status: forced, contentType: 'application/json', body: '{"error":"forced"}' });
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

  const api: RelayFixture = {
    store,
    install: (context) => context.route(/\/api\//, onRoute),
    requests: () => [...seen],
    failWith: (s) => void (forced = s),
    unmatched: () => [...unmatched],
  };
  return { api, guardErrors: () => [...unmatched] };
}

export interface Device {
  context: BrowserContext;
  page: Page;
  camera: FakeCamera;
}

async function newDevice(browser: Browser, relay: RelayFixture): Promise<Device> {
  const context = await browser.newContext({
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'allow',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  await relay.install(context);
  const page = await context.newPage();
  const camera = await installFakeCamera(page);
  return { context, page, camera };
}

export const test = base.extend<{ relay: RelayFixture; twoDevices: { a: Device; b: Device } }>({
  relay: [
    async ({ context }, use) => {
      const { api, guardErrors } = createRelay();
      await api.install(context);
      await use(api);
      const bad = guardErrors();
      if (bad.length > 0) throw new Error(`Unrouted /api requests:\n${bad.join('\n')}`);
    },
    { auto: true },
  ],
  twoDevices: async ({ browser, relay }, use) => {
    const a = await newDevice(browser, relay);
    const b = await newDevice(browser, relay);
    await use({ a, b });
    await a.context.close();
    await b.context.close();
  },
});

export { expect };
