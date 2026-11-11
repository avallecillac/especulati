import { describe, expect, it } from 'vitest';
import { parseGbVolume } from './googleBooks.ts';
import { firstEntry } from './testkit.ts';

describe('parseGbVolume', () => {
  it('parses the Dune volume and rewrites the thumbnail to https', () => {
    const item = firstEntry('gb-isbn-9780441172719');
    expect(parseGbVolume(item)).toEqual({
      title: 'Dune',
      authors: ['Frank Herbert'],
      totalPages: 612,
      genre: 'Fiction',
      coverUrl: 'https://books.google.com/books/content?id=B1hSG45JCX4C&zoom=1',
      firstPublishYear: null,
    });
  });
  it('validates page counts', () => {
    expect(parseGbVolume({ volumeInfo: { title: 'T', pageCount: 0 } })?.totalPages).toBeNull();
    expect(parseGbVolume({ volumeInfo: { title: 'T', pageCount: 20000 } })?.totalPages).toBeNull();
  });
  it('returns null without a title', () => {
    expect(parseGbVolume({ volumeInfo: {} })).toBeNull();
    expect(parseGbVolume(undefined)).toBeNull();
  });
});
