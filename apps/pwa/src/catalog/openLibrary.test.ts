import { describe, expect, it } from 'vitest';
import { parseOlEdition, parseOlSearchDoc } from './openLibrary.ts';
import { firstEntry, fixtureJson } from './testkit.ts';

describe('parseOlSearchDoc', () => {
  it('parses the Dune search doc', () => {
    const doc = firstEntry('ol-search-isbn-9780441172719');
    expect(parseOlSearchDoc(doc)).toEqual({
      title: 'Dune',
      authors: ['Frank Herbert'],
      totalPages: 608,
      genre: 'Science Fiction',
      coverUrl: 'https://covers.openlibrary.org/b/id/11481354-L.jpg',
      firstPublishYear: 1965,
    });
  });
  it('returns null for missing or title-less docs', () => {
    expect(parseOlSearchDoc(undefined)).toBeNull();
    expect(parseOlSearchDoc({ author_name: ['x'] })).toBeNull();
  });
  it('drops invalid page counts and cover ids', () => {
    for (const bad of [0, -3, 10001, 12.5, '300', null]) {
      expect(parseOlSearchDoc({ title: 'T', number_of_pages_median: bad })?.totalPages).toBeNull();
    }
    expect(parseOlSearchDoc({ title: 'T', number_of_pages_median: 10000 })?.totalPages).toBe(10000);
    expect(parseOlSearchDoc({ title: 'T', cover_i: 0 })?.coverUrl).toBeNull();
    expect(parseOlSearchDoc({ title: 'T', cover_i: -1 })?.coverUrl).toBeNull();
  });
});

describe('parseOlEdition', () => {
  it('reads pages and the first cover', () => {
    expect(parseOlEdition(fixtureJson('ol-edition-9780441172719'))).toEqual({
      totalPages: 535,
      coverUrl: 'https://covers.openlibrary.org/b/id/15166231-L.jpg',
    });
  });
  it('skips negative cover ids (Silent Patient: [8415060, -1])', () => {
    expect(parseOlEdition(fixtureJson('ol-edition-9781250301697')).coverUrl).toBe(
      'https://covers.openlibrary.org/b/id/8415060-L.jpg',
    );
    expect(parseOlEdition({ covers: [-1, 0, 77] }).coverUrl).toBe('https://covers.openlibrary.org/b/id/77-L.jpg');
    expect(parseOlEdition({ covers: [-1] }).coverUrl).toBeNull();
  });
  it('validates page counts', () => {
    expect(parseOlEdition({ number_of_pages: 0 }).totalPages).toBeNull();
    expect(parseOlEdition({ number_of_pages: 99999 }).totalPages).toBeNull();
    expect(parseOlEdition({}).totalPages).toBeNull();
    expect(parseOlEdition(null).totalPages).toBeNull();
  });
});
