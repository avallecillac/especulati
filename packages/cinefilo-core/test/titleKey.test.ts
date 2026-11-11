import { describe, expect, it } from 'vitest';
import { manualTitleLabel, ratingLabel, titleKey, tmdbTitleLabel } from '../src/index.ts';

describe('titleKey', () => {
  it('Amélie = amelie', () => {
    expect(titleKey('Amélie')).toBe(titleKey('amelie'));
    expect(titleKey('Amélie')).toBe('amelie');
  });
  it('collapses spaces and punctuation', () => {
    expect(titleKey('  In  the   Mood, for Love! ')).toBe('in the mood for love');
    expect(titleKey('WALL·E')).toBe('wall e');
  });
  it('folds compatibility forms (NFKD)', () => {
    expect(titleKey('ＳＯＬＡＲＩＳ')).toBe('solaris');
  });
  it('keeps digits and non-latin letters', () => {
    expect(titleKey('Se7en')).toBe('se7en');
    expect(titleKey('千と千尋の神隠し')).toBe('千と千尋の神隠し');
  });
});

describe('title labels', () => {
  it('tmdb label is kind-and-id based', () => {
    expect(tmdbTitleLabel('movie', 603)).toBe('cinefilo-title-v1|tmdb|movie|603');
  });
  it('manual label uses the normalized title and the year', () => {
    expect(manualTitleLabel('movie', 'Amélie', 2001)).toBe('cinefilo-title-v1|manual|movie|amelie|2001');
    expect(manualTitleLabel('movie', 'amelie', 2001)).toBe(manualTitleLabel('movie', 'Amélie', 2001));
    expect(manualTitleLabel('movie', 'Stalker', null)).toBe('cinefilo-title-v1|manual|movie|stalker|');
  });
  it('Solaris 1972 differs from Solaris 2002', () => {
    expect(manualTitleLabel('movie', 'Solaris', 1972)).not.toBe(manualTitleLabel('movie', 'Solaris', 2002));
  });
  it('movie differs from series', () => {
    expect(manualTitleLabel('movie', 'Dark', 2017)).not.toBe(manualTitleLabel('series', 'Dark', 2017));
    expect(tmdbTitleLabel('movie', 1)).not.toBe(tmdbTitleLabel('series', 1));
  });
  it('rating label is a function of title and member', () => {
    expect(ratingLabel('t1', 'm1')).toBe('cinefilo-rating-v1|t1|m1');
    expect(ratingLabel('t1', 'm1')).not.toBe(ratingLabel('t1', 'm2'));
  });
});
