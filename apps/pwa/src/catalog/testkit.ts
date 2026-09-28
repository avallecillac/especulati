 
// Test helpers: a fake `fetch` that serves the recorded fixtures by URL.
const raw = import.meta.glob('./fixtures/*.json', { eager: true, query: '?raw', import: 'default' });

export function fixture(name: string): string {
  const text = raw[`./fixtures/${name}.json`];
  if (text === undefined) throw new Error(`no fixture ${name}`);
  return text;
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name));
}

/** First element of `docs` (Open Library) or `items` (Google Books) in a fixture. */
export function firstEntry(name: string): Record<string, unknown> {
  const j = fixtureJson(name) as { docs?: Record<string, unknown>[]; items?: Record<string, unknown>[] };
  const first = (j.docs ?? j.items)?.[0];
  if (!first) throw new Error(`fixture ${name} has no entries`);
  return first;
}

export type Route = { status?: number; body?: string; contentType?: string } | 'hang' | 'throw';

export interface FakeFetch {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit | undefined }[];
}

const OL = 'https://openlibrary.org';
export const olSearchUrl = (isbn: string) =>
  `${OL}/search.json?isbn=${isbn}&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject&limit=1`;
export const olEditionUrl = (isbn: string) => `${OL}/isbn/${isbn}.json`;
export const gbUrl = (isbn: string) => `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`;

/** Routes URL → fixture-backed response. Unrouted URLs return 404. `routes` overrides per URL. */
export function fakeFetch(routes: Record<string, Route> = {}): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const route = routes[url];
    if (route === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    if (route === 'hang') {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    const r = route ?? { status: 404, body: '{}' };
    return Promise.resolve(
      new Response(r.body ?? '{}', {
        status: r.status ?? 200,
        headers: { 'content-type': r.contentType ?? 'application/json' },
      }),
    );
  };
  return { fetch: impl, calls };
}

/** Routes for one of the 6 recorded ISBNs (search + edition). */
export function isbnRoutes(isbn: string): Record<string, Route> {
  return {
    [olSearchUrl(isbn)]: { body: fixture(`ol-search-isbn-${isbn}`) },
    [olEditionUrl(isbn)]: { body: fixture(`ol-edition-${isbn}`) },
  };
}
