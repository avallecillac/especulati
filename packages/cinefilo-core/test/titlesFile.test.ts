import { describe, expect, it } from 'vitest';
import { parseTitlesFile, TITLES_FORMAT } from '../src/index.ts';

const file = (titles: unknown[], format: unknown = TITLES_FORMAT) => JSON.stringify({ format, titles });
const good = { kind: 'movie', title: 'Inception', year: 2010, tmdbId: 27205, status: 'watched' };
const reason = (text: string) => {
  const r = parseTitlesFile(text);
  if (r.ok) throw new Error('expected failure');
  return r.error;
};

describe('parseTitlesFile (D2)', () => {
  it('names the format', () => expect(TITLES_FORMAT).toBe('cinefilo-titles/v1'));
  it('parses a valid file; year and tmdbId are optional', () => {
    const r = parseTitlesFile(file([good, { kind: 'series', title: '  Dark ', status: 'watching' }, { kind: 'movie', title: 'Nine', year: null, tmdbId: null, status: 'later' }]));
    expect(r).toEqual({
      ok: true,
      value: {
        format: TITLES_FORMAT,
        titles: [
          { ...good, watchOrder: null },
          { kind: 'series', title: 'Dark', year: null, tmdbId: null, status: 'watching', watchOrder: null },
          { kind: 'movie', title: 'Nine', year: null, tmdbId: null, status: 'later', watchOrder: null },
        ],
      },
    });
  });
  it('accepts an empty list', () => expect(parseTitlesFile(file([])).ok).toBe(true));
  it('rejects non-JSON, non-objects and the wrong format', () => {
    expect(reason('nope').field).toBe('file');
    expect(reason('[]').field).toBe('file');
    expect(reason(file([good], 'cinefilo/v1'))).toEqual({ field: 'format', reason: 'unsupported version' });
    expect(reason(JSON.stringify({ format: TITLES_FORMAT, titles: {} })).field).toBe('titles');
  });
  it('rejects a bad kind or status, with the entry index', () => {
    expect(reason(file([good, { ...good, tmdbId: 1, kind: 'show' }])).field).toBe('titles[1].kind');
    expect(reason(file([{ ...good, status: 'done' }])).field).toBe('titles[0].status');
    expect(reason(file([{ ...good, status: 'dropped' }, ])).field).toBe('titles[0].status');
  });
  it('rejects watching on a movie', () => {
    expect(reason(file([{ ...good, status: 'watching' }]))).toEqual({ field: 'titles[0].status', reason: 'watching is only for series' });
  });
  it('rejects an empty title, bad year or tmdbId, unknown fields and non-objects', () => {
    expect(reason(file([{ ...good, title: '  ' }])).field).toBe('titles[0].title');
    expect(reason(file([{ ...good, year: 1700 }])).field).toBe('titles[0].year');
    expect(reason(file([{ ...good, year: '2010' }])).field).toBe('titles[0].year');
    expect(reason(file([{ ...good, tmdbId: 0 }])).field).toBe('titles[0].tmdbId');
    expect(reason(file([{ ...good, tmdbId: 1.5 }])).field).toBe('titles[0].tmdbId');
    expect(reason(file([{ ...good, note: 'x' }])).field).toBe('titles[0].note');
    expect(reason(file(['x'])).field).toBe('titles[0]');
  });
  it('rejects duplicates inside the file: same TMDB id and kind, or same normalized title, kind and year', () => {
    expect(reason(file([good, { ...good, title: 'Other name' }]))).toEqual({ field: 'titles[1]', reason: 'duplicate of titles[0]' });
    const m = { kind: 'movie', title: 'Amélie', year: 2001, status: 'later' };
    expect(reason(file([m, { ...m, title: ' amelie! ', status: 'watched' }])).field).toBe('titles[1]');
  });
  it('allows the same name with a different year, kind or TMDB id', () => {
    const m = { kind: 'movie', title: 'Nine', year: 2009, status: 'later' };
    expect(parseTitlesFile(file([m, { ...m, year: 1982 }, { ...m, kind: 'series' }, { ...good, kind: 'series', status: 'later' }, good])).ok).toBe(true);
  });
});
