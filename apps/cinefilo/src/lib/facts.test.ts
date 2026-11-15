import { describe, expect, it } from 'vitest';
import { detailLines } from './facts.ts';

const base = { kind: 'movie', genres: null, countries: null, directors: null, leadActor: null, leadActress: null } as const;

describe('detailLines', () => {
  it('shows nothing before credits are fetched', () => {
    expect(detailLines(base)).toEqual([]);
  });
  it('lists countries, the first three genres, directors and both leads', () => {
    expect(detailLines({ ...base, countries: ['FR', 'IT'], genres: ['Drama', 'Crime', 'Thriller', 'Romance'], directors: ['A', 'B'], leadActor: 'Him', leadActress: 'Her' })).toEqual([
      'France · Italy · Drama · Crime · Thriller', 'Directed by A, B', 'With Him, Her',
    ]);
  });
  it('says "Created by" for a series and shows only the actor when there is no actress', () => {
    expect(detailLines({ ...base, kind: 'series', countries: [], directors: ['C'], leadActor: 'Him' })).toEqual(['Created by C', 'With Him']);
  });
});
