/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, parseExport, serializeExport, type CinefiloExport } from '../src/index.ts';
import { day, instant, member, memberId, rating, ratingId, title, titleId } from './fixtures.ts';

const sample = (): CinefiloExport => ({
  format: 'cinefilo/v1',
  exportedAt: instant('2026-09-27T12:00:00.000Z'),
  titles: [
    title({ id: titleId(2), kind: 'series', title: 'Severance' as never, tmdbId: 95396, genres: ['Drama', 'Sci-Fi'], seasonCount: 2, status: 'watching', currentSeason: 2, posterUrl: '/p.jpg', originalTitle: 'Severance', year: 2022 }),
    title({ id: titleId(1), status: 'watched', watchedOn: day('2026-09-20'), runtimeMin: 163 }),
    title({ id: titleId(3), deletedAt: '2026-09-25T00:00:00.000Z' as never }),
    title({ id: titleId(4), mergedInto: titleId(1) }),
  ],
  members: [member({ id: memberId(2), name: 'Lucía' as never }), member({ deletedAt: '2026-09-26T00:00:00.000Z' as never })],
  ratings: [
    rating({ id: ratingId(1), verdict: 'like', review: 'Slow but great' as never }),
    rating({ id: ratingId(2), memberId: memberId(2), verdict: null, review: null, deletedAt: '2026-09-26T00:00:00.000Z' as never }),
  ],
});

describe('cinefilo/v1 export', () => {
  it('names the frozen format', () => {
    expect(JSON.parse(serializeExport(sample()))['format']).toBe(EXPORT_FORMAT);
  });
  it('Round trip is lossless, including removed titles, merged rows and both members\' ratings', () => {
    const r = parseExport(serializeExport(sample()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const norm = (x: CinefiloExport) => ({ ...x, titles: [...x.titles].sort((a, b) => (a.id < b.id ? -1 : 1)), members: [...x.members].sort((a, b) => (a.id < b.id ? -1 : 1)), ratings: [...x.ratings].sort((a, b) => (a.id < b.id ? -1 : 1)) });
    expect(r.value).toEqual(norm(sample()));
  });
  it('serialization is deterministic whatever the row order', () => {
    const s = sample();
    expect(serializeExport({ ...s, titles: [...s.titles].reverse(), ratings: [...s.ratings].reverse() })).toBe(serializeExport(s));
  });
  it('serialize is idempotent through parse', () => {
    const text = serializeExport(sample());
    const r = parseExport(text);
    expect(r.ok && serializeExport(r.value)).toBe(text);
  });
  it('an empty space round-trips', () => {
    const e: CinefiloExport = { format: 'cinefilo/v1', exportedAt: instant('2026-01-01T00:00:00.000Z'), titles: [], members: [], ratings: [] };
    expect(parseExport(serializeExport(e))).toEqual({ ok: true, value: e });
  });
  it('Unknown version: cinefilo/v2 and a missing format are rejected', () => {
    const o = JSON.parse(serializeExport(sample()));
    expect(parseExport(JSON.stringify({ ...o, format: 'cinefilo/v2' }))).toEqual({ ok: false, error: { field: 'format', reason: 'unsupported version' } });
    expect(parseExport(JSON.stringify({ ...o, format: undefined })).ok).toBe(false);
    expect(parseExport(JSON.stringify({ ...o, format: 'readerlog/v1' })).ok).toBe(false);
  });
  it('rejects non-JSON and non-objects', () => {
    for (const t of ['', 'nope', '[]', 'null', '3']) expect(parseExport(t).ok, t).toBe(false);
  });
  it('rejects any malformed row, so an import applies nothing', () => {
    const o = JSON.parse(serializeExport(sample()));
    const mutate = (f: (x: Record<string, any>) => void) => { const c = JSON.parse(JSON.stringify(o)) as Record<string, any>; f(c); return parseExport(JSON.stringify(c)).ok; };
    expect(mutate((x) => { x.titles[0].id = 'x'; })).toBe(false);
    expect(mutate((x) => { x.titles[0].status = 'done'; })).toBe(false);
    expect(mutate((x) => { x.titles[0].watchedOn = '2026-02-30'; })).toBe(false);
    expect(mutate((x) => { x.titles[0].genres = [1]; })).toBe(false);
    expect(mutate((x) => { x.titles[0].year = 'a'; })).toBe(false);
    expect(mutate((x) => { x.members[0].name = ''; })).toBe(false);
    expect(mutate((x) => { x.ratings[0].verdict = 'love'; })).toBe(false);
    expect(mutate((x) => { x.ratings[0].review = 'a'.repeat(1001); })).toBe(false);
    expect(mutate((x) => { delete x.ratings; })).toBe(false);
    expect(mutate((x) => { x.titles = {}; })).toBe(false);
    expect(mutate((x) => { x.exportedAt = 'yesterday'; })).toBe(false);
  });
  it('never carries device-local data: extra keys on input rows are dropped on output', () => {
    const s = sample();
    const dirty = { ...s, meta: { tmdb_key: 'SECRET' }, tmdb_key: 'SECRET', titles: s.titles.map((t) => ({ ...t, tmdb_key: 'SECRET' })) };
    expect(serializeExport(dirty as unknown as CinefiloExport)).not.toContain('SECRET');
    const r = parseExport(JSON.stringify(dirty));
    expect(r.ok && serializeExport(r.value)).not.toContain('SECRET');
  });
});
