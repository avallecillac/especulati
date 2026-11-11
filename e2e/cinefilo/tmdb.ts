import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { expect, tab } from './fixtures.ts';

const FIXTURES = fileURLToPath(new URL('../../apps/cinefilo/src/catalog/fixtures/', import.meta.url));
const POSTER = readFileSync(fileURLToPath(new URL('../fixtures/cover.jpg', import.meta.url)));
const read = (name: string) => readFileSync(`${FIXTURES}${name}.json`, 'utf8');

export const KEY = 'e2eKeyDISTINCTIVE0123456789abcdef';

export interface Tmdb {
  /** Every request seen on TMDB hosts: method, host, path and whether it carried the key. */
  requests: { host: string; path: string; hasKey: boolean; at: number }[];
  unmatched: string[];
  /** Answer every API call with this status (null to serve fixtures again). */
  failWith(status: number | null): void;
  posterFetches(): number;
}

/** A mocked TMDB: api.themoviedb.org serves the recorded fixtures, image.tmdb.org a jpeg. Anything else on those hosts is aborted. */
export async function installTmdb(context: BrowserContext): Promise<Tmdb> {
  let forced: number | null = null;
  let posters = 0;
  const api: Tmdb = { requests: [], unmatched: [], failWith: (s) => void (forced = s), posterFetches: () => posters };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

  await context.route(/^https:\/\/(api\.themoviedb\.org|image\.tmdb\.org)\//, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await req.allHeaders();
    api.requests.push({ host: url.host, path: url.pathname, at: Date.now(), hasKey: url.search.includes(KEY) || (headers['authorization'] ?? '').includes(KEY) });
    const json = (body: string, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body });

    if (url.host === 'image.tmdb.org') {
      if (!/^\/t\/p\/w(342|92)\//.test(url.pathname)) return void (api.unmatched.push(req.url()), await route.abort());
      if (url.pathname.startsWith('/t/p/w342/')) posters++;
      return route.fulfill({ status: 200, headers: cors, contentType: 'image/jpeg', body: POSTER });
    }
    if (forced !== null) return json('{"status_message":"forced"}', forced);
    const path = url.pathname.replace(/^\/3\//, '');
    if (path === 'search/multi') return json(/ebenezer/i.test(url.searchParams.get('query') ?? '') ? read('search-ebenezer') : /severance/i.test(url.searchParams.get('query') ?? '') ? read('search-severance') : read('search-empty'));
    if (path === 'tv/95396') return json(read('tv-95396'));
    if (path === 'movie/843') return json(read('movie-843'));
    api.unmatched.push(req.url());
    return route.abort();
  });
  return api;
}

/** Settings → paste the key and save. */
export async function saveKey(page: Page, key = KEY): Promise<void> {
  await tab(page, 'Settings').click();
  await page.getByLabel('TMDB key').fill(key);
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByTestId('tmdb-key-status')).toHaveText('A key is saved on this device.');
}
