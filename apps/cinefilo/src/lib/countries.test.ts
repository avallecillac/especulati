import { describe, expect, it } from 'vitest';
import { countryName } from './countries.ts';

describe('countryName', () => {
  it('gives the English region name', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('IT')).toBe('Italy');
    expect(countryName('US')).toMatch(/United States/);
  });
  it('falls back to the code when it is not a region', () => {
    expect(countryName('ZZZ-not')).toBe('ZZZ-not');
  });
});
