import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { writeBarcode } from 'zxing-wasm/full';

/**
 * E2E harness for feature 002 (T016): a fake catalog network and a fake camera.
 * No test may reach the real catalog hosts: anything the harness has no rule for is
 * recorded and aborted, and the `catalog` fixture (auto) fails the test afterwards.
 */

const FIXTURES = fileURLToPath(new URL('../../apps/pwa/src/catalog/fixtures/', import.meta.url));
const COVER_JPG = fileURLToPath(new URL('./cover.jpg', import.meta.url));

export type CatalogHost = 'openlibrary' | 'covers' | 'googleapis';

const HOST_NAMES: Record<string, CatalogHost> = {
  'openlibrary.org': 'openlibrary',
  'covers.openlibrary.org': 'covers',
  'www.googleapis.com': 'googleapis',
};

const fixturePath = (name: string) => `${FIXTURES}${name}`;
const readFixture = (name: string): string | null =>
  existsSync(fixturePath(name)) ? readFileSync(fixturePath(name), 'utf8') : null;

const NOT_FOUND = '{"error":"notfound"}';
const NO_DOCS = '{"numFound":0,"docs":[]}';
const NO_ITEMS = '{"totalItems":0}';

export interface Catalog {
  /** Force "not in any catalog" for this ISBN (search miss, edition 404, Google Books empty). */
  miss(isbn: string): void;
  /** Delay every catalog response by `ms`. */
  delay(ms: number): void;
  /** Make a host answer every request with `status` (googleapis 429 serves gb-429.json, 403 serves gb-403-referer.json). */
  fail(host: CatalogHost, status: number): void;
  /** URLs of every request seen on the catalog hosts, in order. */
  requests(): string[];
  /** Every catalog request with the headers the browser sent (lower-case names), in order. */
  requestLog(): { url: string; headers: Record<string, string> }[];
  /** URLs that no rule matched (these were aborted and fail the test). */
  unmatched(): string[];
  /** Self-test only: accept the unmatched requests recorded so far without failing the test. */
  allowUnmatchedForSelfTest(): void;
}

function createCatalog(): { api: Catalog; handle: (route: Route) => Promise<void>; guardErrors: () => string[] } {
  const seen: string[] = [];
  const log: { url: string; headers: Record<string, string> }[] = [];
  const unmatched: string[] = [];
  const misses = new Set<string>();
  const failures = new Map<CatalogHost, number>();
  let delayMs = 0;
  let allowed = false;

  const json = (route: Route, body: string, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body });

  async function handle(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const href = url.href;
    seen.push(href);
    log.push({ url: href, headers: await route.request().allHeaders() });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const host = HOST_NAMES[url.hostname];
    if (!host) return void (unmatched.push(href), await route.abort());

    const failStatus = failures.get(host);
    if (failStatus !== undefined) {
      const body =
        host !== 'googleapis' ? null
        : failStatus === 429 ? readFixture('gb-429.json')
        : failStatus === 403 ? readFixture('gb-403-referer.json')
        : null;
      return json(route, body ?? '{"error":"failed"}', failStatus);
    }

    if (host === 'covers') {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(COVER_JPG) });
    }

    if (host === 'openlibrary') {
      if (url.pathname === '/search.json') {
        const isbn = url.searchParams.get('isbn');
        if (isbn !== null) {
          const hit = misses.has(isbn) ? null : readFixture(`ol-search-isbn-${isbn}.json`);
          return json(route, hit ?? readFixture('ol-search-isbn-miss.json') ?? '{"docs":[]}');
        }
        const q = url.searchParams.get('q');
        if (q !== null) {
          const body = /left.*hand/i.test(q) ? readFixture('ol-search-q-left-hand.json') : null;
          return json(route, body ?? NO_DOCS);
        }
      }
      const edition = /^\/isbn\/(\d+)\.json$/.exec(url.pathname);
      if (edition) {
        const isbn = edition[1]!;
        const body = misses.has(isbn) ? null : readFixture(`ol-edition-${isbn}.json`);
        return body !== null ? json(route, body) : json(route, NOT_FOUND, 404);
      }
    }

    if (host === 'googleapis' && url.pathname === '/books/v1/volumes') {
      const q = url.searchParams.get('q') ?? '';
      const m = /^isbn:(\d+)$/.exec(q);
      if (m) {
        const body = misses.has(m[1]!) ? null : readFixture(`gb-isbn-${m[1]}.json`);
        return json(route, body ?? NO_ITEMS);
      }
      return json(route, NO_ITEMS);
    }

    unmatched.push(href);
    await route.abort();
  }

  const api: Catalog = {
    miss: (isbn) => void misses.add(isbn),
    delay: (ms) => void (delayMs = ms),
    fail: (host, status) => void failures.set(host, status),
    requests: () => [...seen],
    requestLog: () => log.map((l) => ({ url: l.url, headers: { ...l.headers } })),
    unmatched: () => [...unmatched],
    allowUnmatchedForSelfTest: () => void (allowed = true),
  };
  return { api, handle, guardErrors: () => (allowed ? [] : [...unmatched]) };
}

export interface FakeCamera {
  /** Show this barcode value to the camera (before or after the page loaded). */
  show(value: string): Promise<void>;
  /** Make getUserMedia reject with NotAllowedError. */
  deny(): void;
  /** Number of `track.stop()` calls on tracks handed out by getUserMedia. */
  stoppedTracks(): number;
  /** Tracks handed out and not yet stopped. */
  liveTracks(): number;
  /** Number of getUserMedia calls seen. */
  requests(): number;
}

async function barcodeDataUrl(value: string): Promise<string> {
  const { image, error } = await writeBarcode(value, { format: 'EAN13', scale: 4 });
  if (!image) throw new Error(`fakeCamera: cannot draw ${value}: ${error ?? 'unknown error'}`);
  return `data:image/png;base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`;
}

async function installFakeCamera(page: Page): Promise<FakeCamera> {
  let dataUrl: string | null = null;
  let denied = false;
  let created = 0;
  let stopped = 0;
  let calls = 0;

  await page.exposeFunction('__fcState', () => ({ dataUrl, denied }));
  await page.exposeFunction('__fcEvent', (kind: 'request' | 'create' | 'stop') => {
    if (kind === 'request') calls++;
    else if (kind === 'create') created++;
    else stopped++;
  });

  await page.addInitScript(() => {
    type W = Window & {
      __fcState: () => Promise<{ dataUrl: string | null; denied: boolean }>;
      __fcEvent: (kind: 'request' | 'create' | 'stop') => Promise<void>;
    };
    const w = window as unknown as W;
    const getUserMedia = async (): Promise<MediaStream> => {
      void w.__fcEvent('request');
      const first = await w.__fcState();
      if (first.denied) throw new DOMException('denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      let img: HTMLImageElement | null = null;
      let loaded = '';
      const draw = async () => {
        const s = await w.__fcState();
        if (s.dataUrl && s.dataUrl !== loaded) {
          loaded = s.dataUrl;
          const next = new Image();
          next.src = s.dataUrl;
          await next.decode().catch(() => undefined);
          img = next;
        }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 640, 480);
        if (img) ctx.drawImage(img, (640 - img.width) / 2, (480 - img.height) / 2);
      };
      await draw();
      const timer = setInterval(() => void draw(), 100);
      const stream = canvas.captureStream(10);
      for (const track of stream.getTracks()) {
        void w.__fcEvent('create');
        const stop = track.stop.bind(track);
        track.stop = () => {
          void w.__fcEvent('stop');
          stop();
          if (stream.getTracks().every((t) => t.readyState === 'ended')) clearInterval(timer);
        };
      }
      return stream;
    };
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    }
    navigator.mediaDevices.getUserMedia = getUserMedia;
  });

  return {
    async show(value) {
      dataUrl = await barcodeDataUrl(value);
    },
    deny() {
      denied = true;
    },
    stoppedTracks: () => stopped,
    liveTracks: () => created - stopped,
    requests: () => calls,
  };
}

export const test = base.extend<{ catalog: Catalog; fakeCamera: FakeCamera }>({
  catalog: [
    async ({ page }, use) => {
      const { api, handle, guardErrors } = createCatalog();
      await page.route(/^https:\/\/(openlibrary\.org|covers\.openlibrary\.org|www\.googleapis\.com)\//, handle);
      await use(api);
      const bad = guardErrors();
      if (bad.length > 0) {
        throw new Error(`Unrouted catalog requests (no harness rule matched):\n${bad.join('\n')}`);
      }
    },
    { auto: true },
  ],
  fakeCamera: async ({ page }, use) => {
    await use(await installFakeCamera(page));
  },
});

export { expect };
