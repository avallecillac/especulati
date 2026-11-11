import { describe, expect, it } from 'vitest';
import { coverCloth, initials } from './coverArt.ts';

describe('initials', () => {
  it('takes the first two words', () => {
    expect(initials('Dune')).toBe('D');
    expect(initials('Dune Messiah')).toBe('DM');
    expect(initials('a brief history of time')).toBe('BH');
  });
  it('skips a leading article only when other words exist', () => {
    expect(initials('The Hobbit')).toBe('H');
    expect(initials('An Ice Palace')).toBe('IP');
    expect(initials('The')).toBe('T');
    expect(initials('A')).toBe('A');
  });
  it('uses # for ISBN placeholders and empty titles', () => {
    expect(initials('ISBN 9780441172719')).toBe('#');
    expect(initials('   ')).toBe('#');
    expect(initials('!!! ???')).toBe('#');
  });
});

describe('coverCloth', () => {
  it('is stable and within 1..6', () => {
    expect(coverCloth('abc')).toBe(coverCloth('abc'));
    for (const k of ['', 'a', 'Dune', 'x'.repeat(500)]) {
      const n = coverCloth(k);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
  it('uses every cloth across many keys', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => coverCloth(`Book ${i}`)));
    expect(seen.size).toBe(6);
  });
  it('varies with the key', () => {
    expect(new Set(['Dune', 'Emma', 'Ulysses', 'Beloved', 'Dracula'].map(coverCloth)).size).toBeGreaterThan(1);
  });
});
