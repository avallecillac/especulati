import { describe, expect, it } from 'vitest';
import { matchesQuery, matchesItem } from './search.ts';

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

describe('matchesItem (cinefilo-tmdb-credits D7)', () => {
  const godfather = {
    title: 'The Godfather', directors: ['Francis Ford Coppola'], leadActor: 'Marlon Brando', leadActress: 'Diane Keaton',
    genres: ['Drama', 'Crime'], countries: ['US', 'IT'],
  };
  it('matches the title, a director, the actor, the actress and a genre', () => {
    for (const q of ['godf', 'coppola', 'FORD', 'brando', 'keaton', 'crime']) expect(matchesItem(godfather, q), q).toBe(true);
    expect(matchesItem(godfather, 'spielberg')).toBe(false);
  });
  it('matches a country by English name or code, ignoring accents', () => {
    expect(matchesItem(godfather, 'italy')).toBe(true);
    expect(matchesItem(godfather, 'united states')).toBe(true);
    expect(matchesItem(godfather, 'it')).toBe(true);
    expect(matchesItem(godfather, 'france')).toBe(false);
  });
  it('copes with a title that has nothing fetched yet, and an empty query', () => {
    const bare = { title: 'Heat', directors: [], leadActor: null, leadActress: null, genres: [], countries: [] };
    expect(matchesItem(bare, 'heat')).toBe(true);
    expect(matchesItem(bare, 'mann')).toBe(false);
    expect(matchesItem(bare, '  ')).toBe(true);
  });
  it('matches accented names without accents', () => {
    expect(matchesItem({ ...godfather, directors: ['Alejandro González Iñárritu'] }, 'gonzalez inarritu')).toBe(true);
  });
});
