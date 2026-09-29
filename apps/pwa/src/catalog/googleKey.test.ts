import { parseIsbn } from '@readerlog/core';
import { describe, expect, it } from 'vitest';
import { testGoogleKey } from './googleKey.ts';
import { lookupIsbn } from './isbnLookup.ts';
import { searchTitle } from './titleSearch.ts';
import { fakeFetch, fixture, type Route, gbTitleUrl, gbUrl, olSearchUrl, olTitleUrl } from './testkit.ts';

const KEY = 'TEST-KEY-abcd1234';
const ISBN = '9780441172719';
const isbn = (s: string) => {
  const r = parseIsbn(s);
  if (!r.ok) throw new Error(s);
  return r.value;
};
const online = () => true;
const gbKeyed = (u: string) => `${u}&key=${encodeURIComponent(KEY)}`;
const gbFound = { body: fixture('gb-isbn-9780441172719') };

describe('Google Books key on lookupIsbn', () => {
  it('appends the key and uses strict-origin only on the Google request', async () => {
    const f = fakeFetch({ [gbKeyed(gbUrl(ISBN))]: gbFound });
    const out = await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online, googleApiKey: KEY });
    expect(out.kind).toBe('found');
    const google = f.calls.filter((c) => c.url.includes('googleapis'));
    expect(google).toHaveLength(1);
    expect(google[0]!.url).toBe(gbKeyed(gbUrl(ISBN)));
    expect(google[0]!.init?.referrerPolicy).toBe('strict-origin');
    for (const c of f.calls.filter((c) => c.url.includes('openlibrary'))) {
      expect(c.url).not.toContain('key=');
      expect(c.init?.referrerPolicy).toBe('no-referrer');
    }
  });

  it('percent-encodes the key', async () => {
    const f = fakeFetch();
    await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online, googleApiKey: 'a b&c' });
    expect(f.calls.find((c) => c.url.includes('googleapis'))!.url).toMatch(/&key=a%20b%26c$/);
  });

  it.each([null, '', undefined])('a %j key leaves the Google request identical to today', async (k) => {
    const f = fakeFetch();
    await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online, ...(k === undefined ? {} : { googleApiKey: k }) });
    const g = f.calls.find((c) => c.url.includes('googleapis'))!;
    expect(g.url).toBe(gbUrl(ISBN));
    expect(g.init?.referrerPolicy).toBe('no-referrer');
  });

  it.each([
    [400, 'gb-400-invalid-key'],
    [403, 'gb-403-referer'],
  ])('a keyed %i is unavailable with keyRejected, never notFound', async (status, name) => {
    const f = fakeFetch({ [olSearchUrl(ISBN)]: { body: '{"docs":[]}' }, [gbKeyed(gbUrl(ISBN))]: { status, body: fixture(name) } });
    const out = await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online, googleApiKey: KEY });
    expect(out).toEqual({ kind: 'unavailable', reason: 'http', status, keyRejected: true });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('an unkeyed 403 has no keyRejected flag', async () => {
    const f = fakeFetch({ [olSearchUrl(ISBN)]: { body: '{"docs":[]}' }, [gbUrl(ISBN)]: { status: 403, body: fixture('gb-403-referer') } });
    const out = await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online });
    expect(out).toEqual({ kind: 'unavailable', reason: 'http', status: 403 });
  });

  it('a found outcome does not contain the key', async () => {
    const f = fakeFetch({ [gbKeyed(gbUrl(ISBN))]: gbFound });
    const out = await lookupIsbn(isbn(ISBN), { fetch: f.fetch, online, googleApiKey: KEY });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
});

describe('Google Books key on searchTitle', () => {
  const q = 'dune';
  it('keys the Google fallback only', async () => {
    const f = fakeFetch({ [olTitleUrl(q)]: { status: 500 }, [gbKeyed(gbTitleUrl(q))]: { body: fixture('gb-isbn-9780441172719') } });
    const out = await searchTitle(q, { fetch: f.fetch, online, googleApiKey: KEY });
    expect(out.kind).toBe('results');
    expect(f.calls[0]!.url).toBe(olTitleUrl(q));
    expect(f.calls[0]!.init?.referrerPolicy).toBe('no-referrer');
    expect(f.calls[1]!.url).toBe(gbKeyed(gbTitleUrl(q)));
    expect(f.calls[1]!.init?.referrerPolicy).toBe('strict-origin');
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('with no key the Google request is unchanged', async () => {
    const f = fakeFetch({ [olTitleUrl(q)]: { status: 500 } });
    await searchTitle(q, { fetch: f.fetch, online, googleApiKey: '' });
    expect(f.calls[1]!.url).toBe(gbTitleUrl(q));
    expect(f.calls[1]!.init?.referrerPolicy).toBe('no-referrer');
  });
});

describe('testGoogleKey', () => {
  const url = gbKeyed(gbUrl(ISBN));
  const run = (route: Route) => testGoogleKey(KEY, { fetch: fakeFetch({ [url]: route }).fetch });

  it('sends request #3 for 9780441172719 with the key and strict-origin', async () => {
    const f = fakeFetch({ [url]: gbFound });
    expect(await testGoogleKey(KEY, { fetch: f.fetch })).toEqual({ kind: 'ok' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(url);
    expect(f.calls[0]!.init?.referrerPolicy).toBe('strict-origin');
  });
  it('400 with "API key not valid" is rejected', async () => {
    expect(await run({ status: 400, body: fixture('gb-400-invalid-key') })).toEqual({ kind: 'rejected' });
  });
  it('403 referrer blocked', async () => {
    expect(await run({ status: 403, body: fixture('gb-403-referer') })).toEqual({ kind: 'refererBlocked' });
  });
  it('403 mentioning referer in the message', async () => {
    expect(await run({ status: 403, body: '{"error":{"message":"Blocked: bad referer"}}' })).toEqual({ kind: 'refererBlocked' });
  });
  it('429 is quota', async () => {
    expect(await run({ status: 429, body: fixture('gb-429') })).toEqual({ kind: 'quota' });
  });
  it('a network error is offline', async () => {
    expect(await run('throw')).toEqual({ kind: 'offline' });
  });
  it('anything else is other with the status', async () => {
    expect(await run({ status: 500 })).toEqual({ kind: 'other', status: 500 });
    expect(await run({ status: 400, body: '{"error":{"message":"bad"}}' })).toEqual({ kind: 'other', status: 400 });
  });
  it('never puts the key in a result', async () => {
    for (const r of [await run({ status: 400, body: fixture('gb-400-invalid-key') }), await run('throw'), await run({ status: 500 })]) {
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });
});
