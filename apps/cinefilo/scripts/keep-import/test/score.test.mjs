import { describe, expect, it } from 'vitest';
import { normalize, similarity } from '../normalize.mjs';
import { mergeCandidates, rank, toCandidate } from '../score.mjs';

const cand = (o) => mergeCandidates([{ tmdbId: 1, kind: 'movie', title: 'X', originalTitle: 'X', year: 2000, overview: '', popularity: 0, ...o }])[0];

describe('similarity', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalize('  Amélie: Le Fabuleux! ')).toBe('amelie le fabuleux');
    expect(similarity('AMELIE', 'Amélie')).toBe(1);
  });
  it('tolerates typos and reordering, penalises partial titles', () => {
    expect(similarity('Inceptoin', 'Inception')).toBeGreaterThan(0.9);
    expect(similarity('Lives Nine', 'Nine Lives')).toBeGreaterThan(0.9);
    expect(similarity('Nine', 'Nine Lives')).toBeLessThan(0.7);
    expect(similarity('Alien', 'Casablanca')).toBeLessThan(0.6);
  });
});

describe('rank / confidence', () => {
  it('is confident with a high top score and a clear lead', () => {
    const r = rank({ title: 'Inception' }, [cand({ tmdbId: 1, title: 'Inception' }), cand({ tmdbId: 2, title: 'Inception Point' })]);
    expect(r.confident).toBe(true);
    expect(r.ranked[0].tmdbId).toBe(1);
  });
  it('is not confident when the top score is below 0.9', () => {
    expect(rank({ title: 'Nine' }, [cand({ title: 'Nine Lives' })]).confident).toBe(false);
  });
  it('is not confident without a lead of 0.1 (two exact matches)', () => {
    const r = rank({ title: 'Nine' }, [cand({ tmdbId: 1, title: 'Nine', year: 2009 }), cand({ tmdbId: 2, title: 'Nine', year: 1999 })]);
    expect(r.confident).toBe(false);
  });
  it('year hint breaks the tie', () => {
    const r = rank({ title: 'Nine', year: 2009 }, [cand({ tmdbId: 1, title: 'Nine', year: 2009 }), cand({ tmdbId: 2, title: 'Nine', year: 1999 })]);
    expect(r.confident).toBe(true);
    expect(r.ranked[0].tmdbId).toBe(1);
  });
  it('kind hint breaks the tie', () => {
    const r = rank({ title: 'Severance', kind: 'series' }, [cand({ tmdbId: 1, title: 'Severance', kind: 'series' }), cand({ tmdbId: 2, title: 'Severance', kind: 'movie' })]);
    expect(r.ranked[0].tmdbId).toBe(1);
    expect(r.confident).toBe(true);
  });
  it('popularity is only a small tie-break', () => {
    const r = rank({ title: 'Heat' }, [cand({ tmdbId: 1, title: 'Heat', popularity: 1 }), cand({ tmdbId: 2, title: 'Heat', popularity: 500 })]);
    expect(r.ranked[0].tmdbId).toBe(2);
    expect(r.ranked[0].score - r.ranked[1].score).toBeLessThan(0.05);
  });
  it('scores against the Spanish, original and English names', () => {
    const c = mergeCandidates([
      toCandidate({ id: 9, title: 'Origen', original_title: 'Inception', release_date: '2010-07-15', media_type: 'movie' }),
      toCandidate({ id: 9, title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', media_type: 'movie' }),
    ]);
    expect(c).toHaveLength(1);
    expect(rank({ title: 'Origen' }, c).confident).toBe(true);
    expect(rank({ title: 'inception' }, c).confident).toBe(true);
  });
  it('ignores people', () => {
    expect(toCandidate({ id: 1, name: 'A', media_type: 'person' })).toBeUndefined();
  });
});
