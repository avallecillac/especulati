import { describe, expect, it } from 'vitest';
import { buildTitles, validateTitlesFile } from '../build.mjs';
import { matchEntries } from '../match.mjs';
import { parseList } from '../parse.mjs';
import { createTmdb } from '../tmdb.mjs';
import { fakeFetch } from './fixtures.mjs';

const matches = await matchEntries(
  parseList('watched\nInception\nNine\nZodiac\nFracture (2007)\nSeverance (serie)\nwatch_later\nPearl (trilogy)\n').entries,
  createTmdb({ fetchFn: fakeFetch(), apiKey: 'k', minIntervalMs: 0 }),
);
const id = (title) => matches.find((m) => m.title === title).id;

describe('buildTitles', () => {
  it('follows cinefilo-titles/v1 exactly', () => {
    const { file } = buildTitles(matches, { [id('Nine')]: 1, [id('Zodiac')]: 'm', [id('Fracture')]: 0 });
    expect(file.format).toBe('cinefilo-titles/v1');
    expect(Object.keys(file)).toEqual(['format', 'titles']);
    expect(file.titles[0]).toEqual({ tmdbId: 27205, kind: 'movie', title: 'Origen', year: 2010, status: 'watched' });
    expect(validateTitlesFile(file)).toEqual([]);
  });
  it('applies decisions: candidate, skip, manual; later list gives status later', () => {
    const { file, summary, pending } = buildTitles(matches, { [id('Nine')]: 2, [id('Zodiac')]: 'm', [id('Fracture')]: 0 });
    expect(file.titles.find((t) => t.tmdbId === 13)).toMatchObject({ kind: 'movie', year: 1999, status: 'watched' });
    expect(file.titles.find((t) => t.title === 'Zodiac')).toEqual({ kind: 'movie', title: 'Zodiac', status: 'watched' });
    expect(file.titles.find((t) => t.title === 'Fracture')).toBeUndefined();
    expect(file.titles.filter((t) => t.status === 'later').map((t) => t.title)).toEqual(['Pearl 1', 'Pearl 2', 'Pearl 3']);
    expect(summary).toMatchObject({ skipped: 1, manual: 1, pending: 0, later: 3 });
    expect(pending).toEqual([]);
  });
  it('reports undecided uncertain lines as pending and leaves them out', () => {
    const { file, pending } = buildTitles(matches, {});
    expect(pending).toContain(id('Nine'));
    expect(file.titles.some((t) => t.title === 'Nine')).toBe(false);
  });
  it('drops duplicate titles', () => {
    const dup = [matches[0], { ...matches[0], id: '99' }];
    const { file, summary } = buildTitles(dup, {});
    expect(file.titles).toHaveLength(1);
    expect(summary.duplicates).toBe(1);
  });
  it('accepts an explicit pick, or a list of picks for a line naming several films', () => {
    const one = { tmdbId: 1597, kind: 'movie', title: 'Los padres de ella', year: 2000 };
    const two = { tmdbId: 693, kind: 'movie', title: 'Los padres de él', year: 2004 };
    const { file } = buildTitles(matches, { [id('Nine')]: [one, two], [id('Zodiac')]: { ...one } });
    const ids = file.titles.map((t) => t.tmdbId);
    expect(ids).toContain(1597);
    expect(ids).toContain(693);
    expect(ids.filter((x) => x === 1597)).toHaveLength(1);
    expect(validateTitlesFile(file)).toEqual([]);
  });

  it('a decision overrides a confident match', () => {
    const { summary } = buildTitles(matches, { [id('Inception')]: 0 });
    expect(summary.skipped).toBe(1);
  });
});

describe('validateTitlesFile', () => {
  const ok = { format: 'cinefilo-titles/v1', titles: [{ kind: 'series', title: 'X', status: 'watching' }] };
  it('accepts a valid file', () => expect(validateTitlesFile(ok)).toEqual([]));
  it.each([
    [{ ...ok, format: 'cinefilo/v1' }],
    [{ ...ok, titles: [{ kind: 'tv', title: 'X', status: 'later' }] }],
    [{ ...ok, titles: [{ kind: 'movie', title: 'X', status: 'watching' }] }],
    [{ ...ok, titles: [{ kind: 'movie', title: '', status: 'later' }] }],
    [{ ...ok, titles: [{ kind: 'movie', title: 'X', status: 'later', tmdbId: 0 }] }],
    [{ ...ok, titles: [{ kind: 'movie', title: 'X', status: 'later', extra: 1 }] }],
  ])('rejects %j', (f) => expect(validateTitlesFile(f).length).toBeGreaterThan(0));
});
