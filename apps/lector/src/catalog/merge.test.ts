import { describe, expect, it } from 'vitest';
import { authorsLabel, mergeDetails } from './merge.ts';

describe('authorsLabel', () => {
  it('formats', () => {
    expect(authorsLabel([])).toBeNull();
    expect(authorsLabel(['A'])).toBe('A');
    expect(authorsLabel(['A', 'B'])).toBe('A & B');
    expect(authorsLabel(['A', 'B', 'C'])).toBe('A, B & C');
  });
});

const base = { title: 'S', authors: ['a'], totalPages: 100, genre: 'Fantasy', coverUrl: 'https://c/s', firstPublishYear: 1990 };
const gb = { title: 'G', authors: ['g'], totalPages: 300, genre: 'Fiction', coverUrl: 'https://c/g', firstPublishYear: null };

describe('mergeDetails', () => {
  it('rule 1: title and authors come from the search doc, else Google', () => {
    expect(mergeDetails({ search: base, edition: null, google: gb })).toMatchObject({ title: 'S', authors: ['a'], source: 'openlibrary' });
    expect(mergeDetails({ search: null, edition: null, google: gb })).toMatchObject({ title: 'G', authors: ['g'], source: 'googlebooks' });
  });
  it('rule 2: pages edition > search median > google', () => {
    expect(mergeDetails({ search: base, edition: { totalPages: 50, coverUrl: null }, google: gb }).totalPages).toBe(50);
    expect(mergeDetails({ search: base, edition: { totalPages: null, coverUrl: null }, google: gb }).totalPages).toBe(100);
    expect(mergeDetails({ search: { ...base, totalPages: null }, edition: null, google: gb }).totalPages).toBe(300);
    expect(mergeDetails({ search: null, edition: null, google: { ...gb, totalPages: null } }).totalPages).toBeNull();
  });
  it('rule 3: cover edition > search > google', () => {
    expect(mergeDetails({ search: base, edition: { totalPages: null, coverUrl: 'https://c/e' }, google: gb }).coverUrl).toBe('https://c/e');
    expect(mergeDetails({ search: base, edition: null, google: gb }).coverUrl).toBe('https://c/s');
    expect(mergeDetails({ search: { ...base, coverUrl: null }, edition: null, google: gb }).coverUrl).toBe('https://c/g');
  });
  it('rule 4: genre from search subjects, else Google categories', () => {
    expect(mergeDetails({ search: base, edition: null, google: gb }).genre).toBe('Fantasy');
    expect(mergeDetails({ search: null, edition: null, google: gb }).genre).toBe('Fiction');
  });
  it('year comes from the search doc', () => {
    expect(mergeDetails({ search: base, edition: null, google: null }).firstPublishYear).toBe(1990);
  });
});
