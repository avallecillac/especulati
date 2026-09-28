import { describe, expect, it } from 'vitest';
import { coverHue, initials } from './coverArt.ts';

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

describe('coverHue', () => {
  it('is stable and within 0..359', () => {
    expect(coverHue('abc')).toBe(coverHue('abc'));
    for (const k of ['', 'a', 'Dune', 'x'.repeat(500)]) {
      const h = coverHue(k);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
  it('varies with the key', () => {
    expect(coverHue('Dune')).not.toBe(coverHue('Emma'));
  });
});
