import { describe, expect, it } from 'vitest';
import { genreFromSubjects } from './genre.ts';
import { firstEntry } from './testkit.ts';

describe('genreFromSubjects', () => {
  it('maps Spanish "Ciencia-ficción" to Science Fiction', () => {
    expect(genreFromSubjects(['Ciencia-ficción', 'Hugo Award Winner'])).toBe('Science Fiction');
  });
  it('prefers the specific genre over Fiction (Dune fixture)', () => {
    const subjects = firstEntry('ol-search-isbn-9780441172719')['subject'] as string[];
    expect(genreFromSubjects(subjects)).toBe('Science Fiction');
  });
  it('returns null when nothing matches, never the raw first subject', () => {
    expect(genreFromSubjects(['Dune (Imaginary place)', 'Ecology'])).toBeNull();
    expect(genreFromSubjects([])).toBeNull();
  });
  it('is case-insensitive and follows table order', () => {
    expect(genreFromSubjects(['NOVELA', 'Fantasy'])).toBe('Fantasy');
    expect(genreFromSubjects(['Self-Help'])).toBe('Self-Help');
    expect(genreFromSubjects(['Novel'])).toBe('Fiction');
  });
});
