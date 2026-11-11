import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, RATING_LABEL_PREFIX, TITLE_LABEL_PREFIX } from '../src/frozen.ts';
import { manualTitleLabel, ratingLabel, tmdbTitleLabel } from '../src/index.ts';

// Changing any of these re-derives every id and splits the catalog. See CLAUDE.md "Frozen identifiers".
describe('frozen identifiers', () => {
  it('pins the values', () => {
    expect(TITLE_LABEL_PREFIX).toBe('cinefilo-title-v1');
    expect(RATING_LABEL_PREFIX).toBe('cinefilo-rating-v1');
    expect(EXPORT_FORMAT).toBe('cinefilo/v1');
  });
  it('label builders start with the pinned prefixes', () => {
    expect(tmdbTitleLabel('movie', 1).startsWith('cinefilo-title-v1|tmdb|')).toBe(true);
    expect(manualTitleLabel('movie', 'x', null).startsWith('cinefilo-title-v1|manual|')).toBe(true);
    expect(ratingLabel('a', 'b').startsWith('cinefilo-rating-v1|')).toBe(true);
  });
});
