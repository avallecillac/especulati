import { parseIsbn } from '@readerlog/core';
import { describe, expect, it } from 'vitest';
import { lookupIsbn } from './isbnLookup.ts';
import { fakeFetch, fixture, gbUrl, isbnRoutes, olEditionUrl, olSearchUrl } from './testkit.ts';

const isbn = (s: string) => {
  const r = parseIsbn(s);
  if (!r.ok) throw new Error(s);
  return r.value;
};
const online = () => true;

const cases = [
  ['9780441478125', 'The Left Hand of Darkness', ['Ursula K. Le Guin'], 304, 'https://covers.openlibrary.org/b/id/284550-L.jpg'],
  ['9780441172719', 'Dune', ['Frank Herbert'], 535, 'https://covers.openlibrary.org/b/id/15166231-L.jpg'],
  ['9780307387899', 'The Road', ['Cormac McCarthy'], 287, 'https://covers.openlibrary.org/b/id/14818095-L.jpg'],
  ['9788437604947', 'Cien años de soledad', ['Gabriel García Márquez'], 493, 'https://covers.openlibrary.org/b/id/1047469-L.jpg'],
  ['9780593135204', 'Project Hail Mary', ['Andy Weir'], 496, 'https://covers.openlibrary.org/b/id/12455001-L.jpg'],
  ['9781250301697', 'The Silent Patient', ['Alex Michaelides'], 336, 'https://covers.openlibrary.org/b/id/8415060-L.jpg'],
] as const;

describe('lookupIsbn', () => {
  it.each(cases)('%s is found with edition pages and cover', async (n, title, authors, pages, cover) => {
    const f = fakeFetch(isbnRoutes(n));
    const out = await lookupIsbn(isbn(n), { fetch: f.fetch, online });
    expect(out.kind).toBe('found');
    if (out.kind !== 'found') return;
    expect(out.details).toMatchObject({ title, authors, totalPages: pages, coverUrl: cover, source: 'openlibrary' });
    // Google is not queried when Open Library has a doc.
    expect(f.calls.map((c) => c.url)).toEqual(expect.arrayContaining([olSearchUrl(n), olEditionUrl(n)]));
    expect(f.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });

  it('falls back to the search median when the edition is a 404', async () => {
    const n = '9780441172719';
    const routes = { ...isbnRoutes(n), [olEditionUrl(n)]: { status: 404 } };
    const out = await lookupIsbn(isbn(n), { fetch: fakeFetch(routes).fetch, online });
    expect(out).toMatchObject({ kind: 'found', details: { title: 'Dune', totalPages: 608 } });
  });

  it('#2 failing (network / 500) never downgrades a found', async () => {
    const n = '9780441172719';
    for (const bad of ['throw', { status: 500 }] as const) {
      const routes = { ...isbnRoutes(n), [olEditionUrl(n)]: bad };
      const out = await lookupIsbn(isbn(n), { fetch: fakeFetch(routes).fetch, online });
      expect(out.kind).toBe('found');
    }
  });

  it('every request carries the privacy options and one shared signal', async () => {
    const n = '9780441172719';
    const f = fakeFetch(isbnRoutes(n));
    await lookupIsbn(isbn(n), { fetch: f.fetch, online });
    expect(f.calls.length).toBe(2);
    for (const c of f.calls) {
      expect(c.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      expect(c.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(f.calls[0]?.init?.signal).toBe(f.calls[1]?.init?.signal);
  });

  const miss = '9791299999991';
  const missRoutes = () => ({
    [olSearchUrl(miss)]: { body: fixture('ol-search-isbn-miss') },
    [olEditionUrl(miss)]: { status: 404 },
  });

  it('miss on OL + Google totalItems 0 → notFound', async () => {
    const routes = { ...missRoutes(), [gbUrl(miss)]: { body: '{"totalItems":0}' } };
    expect(await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online })).toEqual({ kind: 'notFound' });
  });

  it('miss on OL + Google without items key → notFound', async () => {
    const routes = { ...missRoutes(), [gbUrl(miss)]: { body: '{"totalItems":0,"kind":"books#volumes"}' } };
    expect(await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online })).toEqual({ kind: 'notFound' });
  });

  it('miss on OL + Google 429 → unavailable/http (quickstart scenario 8)', async () => {
    const routes = { ...missRoutes(), [gbUrl(miss)]: { status: 429, body: fixture('gb-429') } };
    expect(await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online })).toEqual({
      kind: 'unavailable',
      reason: 'http',
      status: 429,
    });
  });

  it('miss on OL + Google network error → unavailable/network', async () => {
    const routes = { ...missRoutes(), [gbUrl(miss)]: 'throw' as const };
    expect(await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online })).toEqual({
      kind: 'unavailable',
      reason: 'network',
    });
  });

  it('OL search fails and Google says no match → unavailable, not notFound', async () => {
    const routes = { ...missRoutes(), [olSearchUrl(miss)]: { status: 503 }, [gbUrl(miss)]: { body: '{"totalItems":0}' } };
    expect(await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online })).toEqual({
      kind: 'unavailable',
      reason: 'http',
      status: 503,
    });
  });

  it('OL search fails, Google finds it → found from googlebooks, using GB pages and https cover', async () => {
    const n = '9780441172719';
    const routes = {
      [olSearchUrl(n)]: 'throw' as const,
      [olEditionUrl(n)]: { status: 404 },
      [gbUrl(n)]: { body: fixture(`gb-isbn-${n}`) },
    };
    const out = await lookupIsbn(isbn(n), { fetch: fakeFetch(routes).fetch, online });
    expect(out).toMatchObject({
      kind: 'found',
      details: { title: 'Dune', totalPages: 612, source: 'googlebooks', coverUrl: 'https://books.google.com/books/content?id=B1hSG45JCX4C&zoom=1' },
    });
  });

  it('Google fallback still prefers the edition pages and cover from #2', async () => {
    const n = '9780441172719';
    const routes = {
      [olSearchUrl(n)]: { body: '{"docs":[]}' },
      [olEditionUrl(n)]: { body: fixture(`ol-edition-${n}`) },
      [gbUrl(n)]: { body: fixture(`gb-isbn-${n}`) },
    };
    const out = await lookupIsbn(isbn(n), { fetch: fakeFetch(routes).fetch, online });
    expect(out).toMatchObject({ kind: 'found', details: { totalPages: 535, coverUrl: 'https://covers.openlibrary.org/b/id/15166231-L.jpg' } });
  });

  it('offline → unavailable/offline with no fetch call', async () => {
    const f = fakeFetch();
    expect(await lookupIsbn(isbn(miss), { fetch: f.fetch, online: () => false })).toEqual({
      kind: 'unavailable',
      reason: 'offline',
    });
    expect(f.calls).toHaveLength(0);
  });

  it('a hanging fetch → timeout', async () => {
    const routes = { [olSearchUrl(miss)]: 'hang' as const, [olEditionUrl(miss)]: 'hang' as const };
    const t0 = Date.now();
    const out = await lookupIsbn(isbn(miss), { fetch: fakeFetch(routes).fetch, online, timeoutMs: 50 });
    expect(out).toEqual({ kind: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a fetch that ignores the abort signal still times out', async () => {
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    expect(await lookupIsbn(isbn(miss), { fetch: never, online, timeoutMs: 50 })).toEqual({ kind: 'timeout' });
  });
});
