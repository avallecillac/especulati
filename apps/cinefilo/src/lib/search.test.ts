import { describe, expect, it } from 'vitest';
import { matchesQuery } from './search.ts';

describe('matchesQuery', () => {
  it('matches a substring, ignoring case', () => {
    expect(matchesQuery('The Godfather', 'godf')).toBe(true);
    expect(matchesQuery('The Godfather', 'GODF')).toBe(true);
    expect(matchesQuery('The Godfather', 'father')).toBe(true);
    expect(matchesQuery('The Godfather', 'bear')).toBe(false);
  });

  it('ignores accents on either side', () => {
    expect(matchesQuery('Amélie', 'amelie')).toBe(true);
    expect(matchesQuery('Amelie', 'AMÉLIE')).toBe(true);
    expect(matchesQuery('Léon: The Professional', 'leon')).toBe(true);
  });

  it('collapses and trims whitespace', () => {
    expect(matchesQuery('Back to the Future', '  back   to ')).toBe(true);
    expect(matchesQuery('Back  to   the Future', 'to the')).toBe(true);
    expect(matchesQuery('Better Call Saul', 'better\tcall')).toBe(true);
  });

  it('matches everything when the query is empty or blank', () => {
    expect(matchesQuery('Inception', '')).toBe(true);
    expect(matchesQuery('Inception', '   ')).toBe(true);
    expect(matchesQuery('', '')).toBe(true);
  });
});
