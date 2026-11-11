import { describe, expect, it } from 'vitest';
import { findDuplicates, normalizeForMatch, type Item } from '../src/index.ts';
import { book, instant, itemId } from './fixtures.ts';

const ISBN_A = '9780593135204' as Item['isbn'];
const ISBN_B = '9780441013593' as Item['isbn'];
const b = (n: number, p: Partial<Item> = {}) => book({ id: itemId(n), createdAt: instant(`2026-09-0${n}T10:00:00.000Z`), ...p });

describe('normalizeForMatch', () => {
  it('folds case, accents, punctuation and whitespace', () => {
    expect(normalizeForMatch('Cien años de soledad')).toBe(normalizeForMatch('CIEN AÑOS  DE SOLEDAD!'));
    expect(normalizeForMatch('  Ça va, bien?  ')).toBe('ca va bien');
  });
});

describe('findDuplicates', () => {
  it('matches by title and author ignoring case, accents and punctuation', () => {
    const r = findDuplicates([b(1, { title: 'Cien años de soledad' as Item['title'], author: 'G. García Márquez' as Item['author'] }), b(2, { title: 'CIEN AÑOS  DE SOLEDAD!' as Item['title'], author: 'g garcia marquez' as Item['author'] })], []);
    expect(r).toEqual([{ survivor: itemId(1), duplicate: itemId(2), reason: 'titleAuthor' }]);
  });

  it('matches the same ISBN whatever the titles', () => {
    const r = findDuplicates([b(1, { isbn: ISBN_A, title: 'One' as Item['title'] }), b(2, { isbn: ISBN_A, title: 'Other' as Item['title'] })], []);
    expect(r).toEqual([{ survivor: itemId(1), duplicate: itemId(2), reason: 'isbn' }]);
  });

  it('never matches two different ISBNs, even with identical titles', () => {
    expect(findDuplicates([b(1, { isbn: ISBN_A }), b(2, { isbn: ISBN_B })], [])).toEqual([]);
  });

  it('matches one missing ISBN plus the same title and author', () => {
    const r = findDuplicates([b(1, { isbn: ISBN_A, author: 'X' as Item['author'] }), b(2, { isbn: null, author: 'x' as Item['author'] })], []);
    expect(r).toHaveLength(1);
    expect(findDuplicates([b(1, { isbn: ISBN_A, author: 'X' as Item['author'] }), b(2, { isbn: null, author: 'Y' as Item['author'] })], [])).toEqual([]);
  });

  it('picks the smaller (createdAt, id) as survivor, whatever the input order', () => {
    const early = b(2, { createdAt: instant('2026-09-01T00:00:00.000Z') });
    const late = b(1, { createdAt: instant('2026-09-05T00:00:00.000Z') });
    expect(findDuplicates([late, early], [])[0]).toMatchObject({ survivor: itemId(2), duplicate: itemId(1) });
    const t1 = b(3, { createdAt: instant('2026-09-01T00:00:00.000Z') });
    const t2 = b(4, { createdAt: instant('2026-09-01T00:00:00.000Z') });
    expect(findDuplicates([t2, t1], [])[0]).toMatchObject({ survivor: itemId(3), duplicate: itemId(4) });
  });

  it('ignores removed books and non-books', () => {
    expect(findDuplicates([b(1), b(2, { deletedAt: instant('2026-09-10T00:00:00.000Z') })], [])).toEqual([]);
    expect(findDuplicates([b(1), b(2, { type: 'article' })], [])).toEqual([]);
  });

  it('excludes a dismissed pair in either order', () => {
    expect(findDuplicates([b(1), b(2)], [{ itemA: itemId(1), itemB: itemId(2) }])).toEqual([]);
    expect(findDuplicates([b(1), b(2)], [{ itemA: itemId(2), itemB: itemId(1) }])).toEqual([]);
  });

  it('reports each pair once', () => {
    const r = findDuplicates([b(1), b(2), b(3)], []);
    expect(r).toHaveLength(3);
    const keys = r.map((p) => [p.survivor, p.duplicate].sort().join('|'));
    expect(new Set(keys).size).toBe(3);
  });
});
