import { describe, expect, it } from 'vitest';
import { filterByVerdict, matchesVerdictFilter, VERDICT_FILTERS, type Verdict } from '../src/index.ts';

const V: (Verdict | null)[] = ['like', 'meh', 'dislike', null];
const matrix = (f: Parameters<typeof matchesVerdictFilter>[0]) =>
  V.flatMap((m) => V.map((p) => [m, p] as const)).filter(([m, p]) => matchesVerdictFilter(f, m, p));

describe('verdict filters', () => {
  it('lists the five filters', () => {
    expect([...VERDICT_FILTERS]).toEqual(['bothLiked', 'disagree', 'onlyMe', 'partnerNotRated', 'nobody']);
  });
  it('Both liked', () => expect(matrix('bothLiked')).toEqual([['like', 'like']]));
  it('Both rated but disagree', () => {
    expect(matrix('disagree')).toHaveLength(6);
    expect(matrix('disagree').every(([m, p]) => m !== null && p !== null && m !== p)).toBe(true);
  });
  it('Rated by me only', () => expect(matrix('onlyMe')).toEqual([['like', null], ['meh', null], ['dislike', null]]));
  it('Partner hasn\'t rated: any title with no verdict from the partner', () => {
    expect(matrix('partnerNotRated')).toEqual([['like', null], ['meh', null], ['dislike', null], [null, null]]);
  });
  it('Nobody rated yet', () => expect(matrix('nobody')).toEqual([[null, null]]));
  it('filterByVerdict keeps order and applies to any item type', () => {
    const items = [{ id: 1, m: 'like', p: 'like' }, { id: 2, m: 'like', p: null }, { id: 3, m: 'like', p: 'like' }] as const;
    expect(filterByVerdict('bothLiked', items, (i) => [i.m, i.p]).map((i) => i.id)).toEqual([1, 3]);
  });
});
