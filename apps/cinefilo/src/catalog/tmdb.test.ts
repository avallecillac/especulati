import { describe, expect, it } from 'vitest';
import { failureText, isV4Token, searchTmdb, thumbUrl, tmdbDetails } from './tmdb.ts';
import { fakeFetch, fixture } from './testkit.ts';

const V3 = 'v3keyDISTINCTIVE0123456789abcdef';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.SECRETsignatureDISTINCTIVE';

const routes = {
  'search/multi': { body: fixture('search-severance') },
  'tv/95396': { body: fixture('tv-95396') },
  'movie/843': { body: fixture('movie-843') },
};

describe('key shape', () => {
  it('tells a v4 token from a v3 key', () => {
    expect(isV4Token(V4)).toBe(true);
    expect(isV4Token(V3)).toBe(false);
    expect(isV4Token('0123456789abcdef0123456789abcdef')).toBe(false);
  });
});

describe('thumbUrl', () => {
  it('points at the w92 image host with the path only, never a key', () => {
    expect(thumbUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w92/abc.jpg');
  });
});

describe('searchTmdb', () => {
  it('maps movie and tv hits, drops people, and narrows by kind', async () => {
    const f = fakeFetch(routes);
    const r = await searchTmdb('Severance', V3, { fetch: f.fetch });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.value.map((x) => [x.mediaKind, x.tmdbId, x.title, x.year, x.posterPath])).toEqual([
      ['series', 95396, 'Severance', 2022, '/lFf6LLrQjYldcZItzOkGmMMigP7.jpg'],
      ['movie', 1123, 'Severance', 2006, '/ypNBZgyDoSvK7z5N2f3aHLKbtEd.jpg'],
      ['movie', 777, 'Severance Untitled', null, null],
    ]);
    const only = await searchTmdb('Severance', V3, { fetch: fakeFetch(routes).fetch }, 'series');
    expect(only.kind === 'ok' && only.value.map((x) => x.tmdbId)).toEqual([95396]);
  });

  it('sends a v3 key as api_key and a v4 token as a Bearer header, only to api.themoviedb.org', async () => {
    const a = fakeFetch(routes);
    await searchTmdb('x y', V3, { fetch: a.fetch });
    const u = new URL(a.calls[0]!.url);
    expect(u.origin).toBe('https://api.themoviedb.org');
    expect(u.pathname).toBe('/3/search/multi');
    expect(u.searchParams.get('api_key')).toBe(V3);
    expect(u.searchParams.get('query')).toBe('x y');
    expect(a.calls[0]!.init?.headers).toBeUndefined();

    const b = fakeFetch(routes);
    await searchTmdb('x', V4, { fetch: b.fetch });
    expect(b.calls[0]!.url).not.toContain(V4);
    expect(new URL(b.calls[0]!.url).searchParams.has('api_key')).toBe(false);
    expect(b.calls[0]!.init?.headers).toMatchObject({ Authorization: `Bearer ${V4}` });
  });

  it('has outcomes for no key, an empty answer, 401, 429, 500, a bad body, a network error and a timeout', async () => {
    expect(await searchTmdb('x', null, { fetch: fakeFetch({}).fetch })).toEqual({ kind: 'no-key' });
    expect(await searchTmdb('x', '', { fetch: fakeFetch({}).fetch })).toEqual({ kind: 'no-key' });
    expect(await searchTmdb('   ', V3, { fetch: fakeFetch({}).fetch })).toEqual({ kind: 'ok', value: [] });
    const out = (route: Parameters<typeof fakeFetch>[0][string]) => searchTmdb('x', V3, { fetch: fakeFetch({ 'search/multi': route }).fetch, timeoutMs: 50 });
    expect(await out({ status: 401, body: fixture('error-401') })).toEqual({ kind: 'unauthorized' });
    expect(await out({ status: 429 })).toEqual({ kind: 'rate-limited' });
    expect(await out({ status: 500 })).toEqual({ kind: 'http', status: 500 });
    expect(await out({ body: '{"nope":1}' })).toEqual({ kind: 'bad-response' });
    expect(await out({ body: 'not json' })).toEqual({ kind: 'network' });
    expect(await out('throw')).toEqual({ kind: 'network' });
    expect(await out('hang')).toEqual({ kind: 'timeout' });
  });

  it('enforces the 8 s default deadline even when fetch ignores the abort signal', async () => {
    const never = () => new Promise<Response>(() => undefined);
    const start = Date.now();
    const r = await searchTmdb('x', V3, { fetch: never, timeoutMs: 80 });
    expect(r).toEqual({ kind: 'timeout' });
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('tmdbDetails', () => {
  it('maps a series (season count) and a movie (runtime, genres)', async () => {
    const tv = await tmdbDetails('series', 95396, V3, { fetch: fakeFetch(routes).fetch });
    expect(tv).toEqual({
      kind: 'ok',
      value: { tmdbId: 95396, mediaKind: 'series', title: 'Severance', originalTitle: null, year: 2022, posterPath: '/lFf6LLrQjYldcZItzOkGmMMigP7.jpg', genres: ['Drama', 'Mystery', 'Sci-Fi & Fantasy'], runtimeMin: null, seasonCount: 2 },
    });
    const mv = await tmdbDetails('movie', 843, V4, { fetch: fakeFetch(routes).fetch });
    expect(mv.kind === 'ok' && mv.value).toMatchObject({ title: 'In the Mood for Love', originalTitle: '花樣年華', year: 2000, runtimeMin: 99, seasonCount: null, genres: ['Drama', 'Romance'] });
  });

  it('reports not-found and failures', async () => {
    expect(await tmdbDetails('movie', 1, V3, { fetch: fakeFetch({}).fetch })).toEqual({ kind: 'not-found' });
    expect(await tmdbDetails('movie', 1, null, { fetch: fakeFetch({}).fetch })).toEqual({ kind: 'no-key' });
  });
});

describe('the key never leaks (4.3)', () => {
  it('appears in no outcome and no failure text, for either key shape', async () => {
    const seen: string[] = [];
    for (const key of [V3, V4]) {
      for (const route of ['throw', 'hang', { status: 401 }, { status: 500 }, { body: 'x' }] as const) {
        const f = fakeFetch({ 'search/multi': route, 'tv/1': route });
        const a = await searchTmdb('q', key, { fetch: f.fetch, timeoutMs: 30 });
        const b = await tmdbDetails('series', 1, key, { fetch: f.fetch, timeoutMs: 30 });
        for (const o of [a, b]) {
          seen.push(JSON.stringify(o));
          if (o.kind !== 'ok' && o.kind !== 'no-key') seen.push(failureText(o));
        }
      }
    }
    const all = seen.join('\n');
    expect(all.length).toBeGreaterThan(100);
    for (const s of [V3, V4, 'SECRETsignature', 'DISTINCTIVE']) expect(all).not.toContain(s);
  });
});
