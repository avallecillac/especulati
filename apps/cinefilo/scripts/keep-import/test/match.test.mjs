import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchEntries } from '../match.mjs';
import { parseList } from '../parse.mjs';
import { renderReview } from '../review.mjs';
import { createTmdb, isV4Token, parseEnv } from '../tmdb.mjs';
import { fakeFetch } from './fixtures.mjs';

const V3 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.c2lnbmF0dXJl';
const client = (extra = {}) => {
  const log = [];
  const tmdb = createTmdb({ fetchFn: fakeFetch(log), apiKey: V3, minIntervalMs: 0, ...extra });
  return { tmdb, log };
};
const run = async (text, extra) => {
  const c = client(extra);
  return { ...c, matches: await matchEntries(parseList(text).entries, c.tmdb) };
};

describe('matchEntries', () => {
  it('queries es-ES then en-US and is confident on a clear match', async () => {
    const { matches, log } = await run('Inception\n');
    expect(matches[0]).toMatchObject({ status: 'confident', chosen: { tmdbId: 27205, kind: 'movie', year: 2010 } });
    const langs = log.map((l) => new URL(l.url).searchParams.get('language'));
    expect(langs).toEqual(['es-ES', 'en-US']);
    expect(log.every((l) => l.url.includes('search/multi'))).toBe(true);
  });
  it('sends uncertain lines to review with up to 5 ranked candidates', async () => {
    const { matches } = await run('Nine\n');
    expect(matches[0].status).toBe('uncertain');
    expect(matches[0].candidates.length).toBeLessThanOrEqual(5);
    expect(matches[0].candidates.length).toBe(3);
    expect(matches[0].candidates[0].score).toBeGreaterThanOrEqual(matches[0].candidates[1].score);
  });
  it('is uncertain with no candidates at all', async () => {
    const { matches } = await run('Zodiac\n');
    expect(matches[0]).toMatchObject({ status: 'uncertain', candidates: [] });
  });
  it('uses the kind hint to also query search/tv and settle movie vs series', async () => {
    const { matches, log } = await run('Severance (serie)\n');
    expect(matches[0]).toMatchObject({ status: 'confident', chosen: { tmdbId: 95396, kind: 'series' } });
    expect(log.some((l) => l.url.includes('search/tv'))).toBe(true);
    expect((await run('Severance\n')).matches[0].status).toBe('uncertain');
  });
  it('expands (trilogy) from the collection, ordered by release', async () => {
    const { matches, log } = await run('Pearl (trilogy)\n');
    expect(matches.map((m) => m.chosen.title)).toEqual(['Pearl 1', 'Pearl 2', 'Pearl 3']);
    expect(matches.map((m) => m.id)).toEqual(['1.1', '1.2', '1.3']);
    expect(log.some((l) => l.url.includes('search/collection'))).toBe(true);
    expect(log.some((l) => l.url.includes('collection/900'))).toBe(true);
  });
  it('takes the Nth collection part for a numbered line, limited to the numbers given', async () => {
    const { matches } = await run('Pearl 1, 3\n');
    expect(matches.map((m) => m.chosen.tmdbId)).toEqual([901, 903]);
  });
  it('falls back to a normal search when no collection matches', async () => {
    const { matches } = await run('Zodiac 1, 2\n');
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.status === 'uncertain')).toBe(true);
  });
});

describe('renderReview', () => {
  it('lists uncertain entries with numbered candidates, skip and manual; collapses confident ones', async () => {
    const { matches } = await run('Inception\nNine\n');
    const md = renderReview(matches);
    expect(md).toContain('### 2. Nine');
    expect(md).toMatch(/^1\) Nine \(2009\) movie/m);
    expect(md).toMatch(/^3\) Nine \(2012\) series/m);
    expect(md).toContain('0) skip');
    expect(md).toContain('m) manual');
    expect(md).toContain('<details>');
    expect(md).toContain('1. Inception → Origen (2010) movie #27205');
    expect(md).not.toMatch(/### 1\./);
  });
  it('shows the original title and truncates overviews to 80 chars', async () => {
    const md = renderReview((await run('Nine\n')).matches);
    expect(md).toMatch(/^2\) Nueve \(1999\) movie \/ Nine/m);
    const line = md.split('\n').find((l) => l.startsWith('1) Nine (2009)'));
    expect(line.split(' · ')[1].length).toBeLessThanOrEqual(80);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('tmdb client', () => {
  it('uses api_key for a v3 key and a Bearer header for a v4 token', async () => {
    const a = client();
    await a.tmdb.get('search/multi', { query: 'x' });
    expect(a.log[0].url).toContain(`api_key=${V3}`);
    expect(a.log[0].init.headers.authorization).toBeUndefined();
    const b = client({ apiKey: V4 });
    await b.tmdb.get('search/multi', { query: 'x' });
    expect(b.log[0].url).not.toContain('api_key');
    expect(b.log[0].init.headers.authorization).toBe(`Bearer ${V4}`);
    expect(isV4Token(V4)).toBe(true);
    expect(isV4Token(V3)).toBe(false);
  });
  it('throttles live calls to at most 4 per second', async () => {
    let t = 0;
    const sleeps = [];
    const { tmdb } = client({ minIntervalMs: 250, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    for (let i = 0; i < 3; i++) await tmdb.get('search/multi', { query: `q${i}` });
    expect(sleeps).toEqual([250, 250]);
  });
  it('caches by URL, without the key, and never writes the key to disk', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'keep-import-'));
    const a = client({ cacheDir: dir });
    await a.tmdb.get('search/multi', { query: 'Inception', language: 'es-ES' });
    const b = client({ cacheDir: dir, apiKey: undefined });
    const body = await b.tmdb.get('search/multi', { query: 'Inception', language: 'es-ES' });
    expect(b.log).toHaveLength(0);
    expect(b.tmdb.stats.cached).toBe(1);
    expect(body.results.length).toBeGreaterThan(0);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    for (const f of files) {
      expect(f).not.toContain(V3);
      expect(await readFile(path.join(dir, f), 'utf8')).not.toContain(V3);
    }
  });
  it('never puts the key in errors', async () => {
    const failing = async () => ({ ok: false, status: 401, json: async () => ({}) });
    for (const key of [V3, V4]) {
      const { tmdb } = client({ fetchFn: failing, apiKey: key });
      const err = await tmdb.get('search/multi', { query: 'x' }).catch((e) => e);
      expect(String(err.message)).toMatch(/401/);
      expect(String(err.message)).not.toContain(key);
    }
    const boom = async (u) => { throw new Error(`network ${u}`); };
    const err = await client({ fetchFn: boom }).tmdb.get('search/multi', { query: 'x' }).catch((e) => e);
    expect(String(err.message)).not.toContain(V3);
  });
  it('asks for a key when there is none and nothing cached', async () => {
    const err = await client({ apiKey: undefined }).tmdb.get('search/multi', { query: 'x' }).catch((e) => e);
    expect(err.message).toMatch(/TMDB_API_KEY/);
  });
  it('reads TMDB_API_KEY from .env text', () => {
    expect(parseEnv('# c\nFOO=1\nTMDB_API_KEY="abc"\n').TMDB_API_KEY).toBe('abc');
  });
  it('writes no key into the match outputs', async () => {
    const { matches } = await run('Inception\nNine\n');
    expect(JSON.stringify(matches) + renderReview(matches)).not.toContain(V3);
  });
});
